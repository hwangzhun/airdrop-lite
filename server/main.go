package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	switch command {
	case "serve":
		withTurn := len(os.Args) > 2 && os.Args[2] == "--with-turn"
		if err := serve(withTurn); err != nil {
			log.Fatal(err)
		}
	case "healthcheck":
		if err := healthcheck(); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("unknown command %q", command)
	}
}

func serve(withTurn bool) error {
	if withTurn {
		if err := validateTurnEnvironment(); err != nil {
			return err
		}
	}

	app := newApplication(appConfig{staticDir: envOrDefault("STATIC_DIR", "dist")})
	defer app.shutdown()
	server := &http.Server{
		Addr:              ":" + envOrDefault("PORT", "8080"),
		Handler:           app,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()
	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("AirDrop-Lite listening on http://0.0.0.0%s", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	var turn *exec.Cmd
	var turnErrors chan error
	if withTurn {
		turn = turnCommand()
		turn.Stdout, turn.Stderr = os.Stdout, os.Stderr
		if err := turn.Start(); err != nil {
			return fmt.Errorf("start turnserver: %w", err)
		}
		turnErrors = make(chan error, 1)
		go func() { turnErrors <- turn.Wait() }()
	}

	var result error
	select {
	case <-ctx.Done():
		log.Print("shutdown requested")
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			result = fmt.Errorf("http server stopped: %w", err)
		}
	case err := <-turnErrors:
		result = fmt.Errorf("turnserver stopped: %w", err)
		turn = nil
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownContext)
	if turn != nil && turn.Process != nil {
		_ = turn.Process.Signal(syscall.SIGTERM)
		select {
		case <-turnErrors:
		case <-time.After(5 * time.Second):
			_ = turn.Process.Kill()
		}
	}
	return result
}

func validateTurnEnvironment() error {
	secret := os.Getenv("TURN_SECRET")
	if secret == "" {
		return errors.New("TURN_SECRET must be set")
	}
	if os.Getenv("TURN_HOST") == "" {
		return errors.New("TURN_HOST must be set to the public TURN hostname or IP")
	}
	if os.Getenv("NODE_ENV") == "production" && len(secret) < 24 {
		return errors.New("TURN_SECRET must contain at least 24 characters in production")
	}
	return nil
}

func turnCommand() *exec.Cmd {
	arguments := []string{
		"-n", "--fingerprint", "--use-auth-secret",
		"--static-auth-secret=" + os.Getenv("TURN_SECRET"),
		"--realm=" + envOrDefault("TURN_REALM", os.Getenv("TURN_HOST")),
		"--listening-port=" + envOrDefault("TURN_PORT", "3478"),
		"--min-port=" + envOrDefault("TURN_MIN_PORT", "49160"),
		"--max-port=" + envOrDefault("TURN_MAX_PORT", "49200"),
		"--no-tls", "--no-dtls", "--no-multicast-peers", "--no-rfc5780",
		"--stale-nonce=600", "--pidfile=/tmp/turnserver.pid", "--log-file=stdout", "--simple-log",
	}
	if externalIP := os.Getenv("TURN_EXTERNAL_IP"); externalIP != "" {
		arguments = append(arguments, "--external-ip="+externalIP)
	}
	return exec.Command("turnserver", arguments...)
}

func healthcheck() error {
	port := envOrDefault("PORT", "8080")
	if _, err := strconv.Atoi(port); err != nil {
		return fmt.Errorf("invalid PORT: %w", err)
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("health endpoint returned %s", response.Status)
	}
	return nil
}
