// Command oscillofloat serves the drawing API and WebSocket.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/puhitaku/oscillofloat/internal/auth"
	"github.com/puhitaku/oscillofloat/internal/server"
	"github.com/puhitaku/oscillofloat/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", "127.0.0.1:8081", "address to listen on")
	dbPath := flag.String("db", "oscillofloat.sqlite", "SQLite database file")
	region := flag.String("cognito-region", "", "region of the user pool")
	poolID := flag.String("cognito-user-pool-id", "", "user pool whose ID tokens are accepted on /api/admin/*")
	clientID := flag.String("cognito-client-id", "", "app client the tokens must be issued to")
	insecureAdmin := flag.Bool("insecure-admin", false, "accept /api/admin/* without a token (development only)")
	trustProxy := flag.Bool("trust-proxy", false, "take the client address from X-Forwarded-For")
	uploadRate := flag.Int("upload-rate", 10, "uploads allowed per client address per minute")
	flag.Parse()

	if *uploadRate < 1 {
		return errors.New("-upload-rate must be at least 1")
	}
	var cognito *auth.Cognito
	var verifier auth.Verifier
	switch set := countSet(*region, *poolID, *clientID); set {
	case 0:
	case 3:
		cognito = &auth.Cognito{Region: *region, UserPoolID: *poolID, ClientID: *clientID}
		verifier = auth.NewCognito(*cognito)
	default:
		return fmt.Errorf("set all of -cognito-region, -cognito-user-pool-id and -cognito-client-id, or none (%d of 3 set)", set)
	}
	if *insecureAdmin {
		slog.Warn("!!! -insecure-admin: /api/admin/* accepts every request without a token; never use this in production !!!")
	} else if cognito == nil {
		slog.Warn("Cognito is not configured; /api/admin/* rejects every request")
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		return fmt.Errorf("open %s: %w", *dbPath, err)
	}
	defer st.Close()

	srv := server.New(server.Config{
		Store:         st,
		Cognito:       cognito,
		Verifier:      verifier,
		InsecureAdmin: *insecureAdmin,
		TrustProxy:    *trustProxy,
		UploadRate:    *uploadRate,
	})
	defer srv.Close()

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	// ReadTimeout and WriteTimeout are left unset: they would stay on the
	// hijacked WebSocket connections and cut them off.
	httpServer := &http.Server{
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	served := make(chan error, 1)
	go func() { served <- httpServer.Serve(ln) }()
	slog.Info("listening on " + ln.Addr().String())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-served:
		return err
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

func countSet(values ...string) int {
	n := 0
	for _, v := range values {
		if v != "" {
			n++
		}
	}
	return n
}
