package server

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/puhitaku/oscillofloat/internal/auth"
	"github.com/puhitaku/oscillofloat/internal/shape"
	"github.com/puhitaku/oscillofloat/internal/store"
)

var (
	sessionPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
	aspectPattern  = regexp.MustCompile(`^[1-9][0-9]*:[1-9][0-9]*$`)
)

func (s *Server) getConfig(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Auth     *auth.Cognito  `json:"auth"`
		Settings store.Settings `json:"settings"`
	}{s.cognito, settings})
}

func sessionID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.Header.Get("X-Session-Id")
	if !sessionPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "X-Session-Id must be 16 to 64 characters of [A-Za-z0-9_-]")
		return "", false
	}
	return id, true
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionID(w, r)
	if !ok {
		return
	}
	if !s.limiter.allow(s.clientAddr(r)) {
		writeError(w, http.StatusTooManyRequests, "too many uploads, try again later")
		return
	}
	var body struct {
		Frame *shape.Frame `json:"frame"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.Frame == nil {
		writeError(w, http.StatusBadRequest, "missing frame")
		return
	}
	if err := body.Frame.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	d, err := s.store.Add(r.Context(), session, *body.Frame)
	if err != nil {
		s.internalError(w, err)
		return
	}
	s.hub.broadcast(addedMessage{Type: "added", Drawing: d})
	writeJSON(w, http.StatusCreated, store.Summary{ID: d.ID, CreatedAt: d.CreatedAt})
}

func (s *Server) deleteOwn(w http.ResponseWriter, r *http.Request) {
	session, ok := sessionID(w, r)
	if !ok {
		return
	}
	ids, err := s.store.DeleteBySession(r.Context(), session)
	if err != nil {
		s.internalError(w, err)
		return
	}
	s.removed(w, ids)
}

func (s *Server) adminList(w http.ResponseWriter, r *http.Request) {
	ds, err := s.store.All(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]store.Drawing{"drawings": ds})
}

func (s *Server) adminDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	ids, err := s.store.Delete(r.Context(), body.IDs)
	if err != nil {
		s.internalError(w, err)
		return
	}
	s.removed(w, ids)
}

func (s *Server) removed(w http.ResponseWriter, ids []string) {
	if len(ids) > 0 {
		s.hub.broadcast(removedMessage{Type: "removed", IDs: ids})
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": len(ids)})
}

func (s *Server) adminSettings(w http.ResponseWriter, r *http.Request) {
	var settings store.Settings
	if !decodeBody(w, r, &settings) {
		return
	}
	if err := validateAspect(settings.Aspect); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SetSettings(r.Context(), settings); err != nil {
		s.internalError(w, err)
		return
	}
	stored, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stored)
}

func validateAspect(aspect string) error {
	invalid := fmt.Errorf("aspect must be W:H with positive integers between 1:4 and 4:1, got %q", aspect)
	if !aspectPattern.MatchString(aspect) {
		return invalid
	}
	ws, hs, _ := strings.Cut(aspect, ":")
	w, errW := strconv.ParseFloat(ws, 64)
	h, errH := strconv.ParseFloat(hs, 64)
	if errW != nil || errH != nil || w > 4*h || h > 4*w {
		return invalid
	}
	return nil
}

func (s *Server) internalError(w http.ResponseWriter, err error) {
	s.log.Error("request failed", "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}
