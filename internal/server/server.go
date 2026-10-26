// Package server serves the HTTP API and the WebSocket.
package server

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"slices"
	"strings"

	"github.com/puhitaku/oscillofloat/internal/auth"
	"github.com/puhitaku/oscillofloat/internal/store"
)

const maxBodyBytes = 1 << 20

// Config configures a Server.
type Config struct {
	Store *store.Store
	// Cognito is reported on /api/config; nil when the backend runs without it.
	Cognito *auth.Cognito
	// Verifier checks admin tokens; nil rejects every admin request unless
	// InsecureAdmin is set.
	Verifier      auth.Verifier
	InsecureAdmin bool
	TrustProxy    bool
	// UploadRate is the number of uploads allowed per client address per
	// minute.
	UploadRate int
	Logger     *slog.Logger
}

// Server is the HTTP handler of the backend.
type Server struct {
	store         *store.Store
	cognito       *auth.Cognito
	verifier      auth.Verifier
	insecureAdmin bool
	trustProxy    bool
	limiter       *rateLimiter
	hub           *hub
	log           *slog.Logger
	mux           *http.ServeMux
}

// New returns a Server for the configuration.
func New(cfg Config) *Server {
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	s := &Server{
		store:         cfg.Store,
		cognito:       cfg.Cognito,
		verifier:      cfg.Verifier,
		insecureAdmin: cfg.InsecureAdmin,
		trustProxy:    cfg.TrustProxy,
		limiter:       newRateLimiter(cfg.UploadRate),
		hub:           newHub(),
		log:           log,
		mux:           http.NewServeMux(),
	}
	s.route("/api/config", map[string]http.HandlerFunc{
		"GET": s.getConfig,
	})
	s.route("/api/drawings", map[string]http.HandlerFunc{
		"POST":   s.upload,
		"DELETE": s.deleteOwn,
	})
	s.route("/api/admin/drawings", map[string]http.HandlerFunc{
		"GET":    s.admin(s.adminList),
		"DELETE": s.admin(s.adminDelete),
	})
	s.route("/api/admin/settings", map[string]http.HandlerFunc{
		"PUT": s.admin(s.adminSettings),
	})
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	s.mux.HandleFunc("GET /ws", s.serveWS)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// Close disconnects every WebSocket client and waits for their handlers to
// return. http.Server.Shutdown does not wait for them because their
// connections are hijacked.
func (s *Server) Close() {
	s.hub.close()
}

// route registers a handler per method and answers other methods with a JSON
// 405, which the mux would otherwise answer in plain text.
func (s *Server) route(path string, handlers map[string]http.HandlerFunc) {
	var allow []string
	for method, h := range handlers {
		s.mux.HandleFunc(method+" "+path, h)
		allow = append(allow, method)
		if method == http.MethodGet {
			allow = append(allow, http.MethodHead)
		}
	}
	slices.Sort(allow)
	s.mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", strings.Join(allow, ", "))
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	})
}

func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	if s.insecureAdmin {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if s.verifier == nil {
			writeError(w, http.StatusUnauthorized, "admin authentication is not configured")
			return
		}
		scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		if !strings.EqualFold(scheme, "Bearer") || token == "" {
			writeError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		if err := s.verifier.Verify(r.Context(), token); err != nil {
			s.log.Info("admin token rejected", "err", err)
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		next(w, r)
	}
}

func (s *Server) clientAddr(r *http.Request) string {
	if s.trustProxy {
		// Not the first entry: CloudFront appends the viewer's address to
		// whatever X-Forwarded-For the viewer sent, so only the last one is
		// trustworthy and the first can be chosen freely to dodge the limit.
		xff := r.Header.Get("X-Forwarded-For")
		if last := strings.TrimSpace(xff[strings.LastIndex(xff, ",")+1:]); last != "" {
			return last
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	err := dec.Decode(v)
	if err == nil {
		if dec.Decode(&struct{}{}) != io.EOF {
			err = errors.New("unexpected data after the JSON value")
		}
	}
	var tooLarge *http.MaxBytesError
	switch {
	case err == nil:
		return true
	case errors.As(err, &tooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "body too large")
	case errors.Is(err, io.EOF):
		writeError(w, http.StatusBadRequest, "empty body")
	default:
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
	}
	return false
}
