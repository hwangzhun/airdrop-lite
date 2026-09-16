package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
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
		if err := serve(); err != nil {
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

func serve() error {
	turnURL, turnToken, turnTTL, stunOnly, err := cloudflareTurnConfig()
	if err != nil {
		return err
	}

	app := newApplication(appConfig{
		staticDir:          envOrDefault("STATIC_DIR", "dist"),
		turnCredentialsURL: turnURL,
		turnAPIToken:       turnToken,
		turnTTL:            turnTTL,
		stunOnly:           stunOnly,
	})
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

	var result error
	select {
	case <-ctx.Done():
		log.Print("shutdown requested")
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			result = fmt.Errorf("http server stopped: %w", err)
		}
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownContext)
	return result
}

func cloudflareTurnConfig() (string, string, time.Duration, bool, error) {
	keyID := os.Getenv("CLOUDFLARE_TURN_KEY_ID")
	token := os.Getenv("CLOUDFLARE_TURN_API_TOKEN")
	if keyID == "" && token == "" && os.Getenv("NODE_ENV") != "production" {
		return "", "", defaultTurnTTL, true, nil
	}
	if keyID == "" {
		return "", "", 0, false, errors.New("CLOUDFLARE_TURN_KEY_ID must be set")
	}
	if token == "" {
		return "", "", 0, false, errors.New("CLOUDFLARE_TURN_API_TOKEN must be set")
	}
	ttlSeconds, err := strconv.Atoi(envOrDefault("CLOUDFLARE_TURN_TTL", "7200"))
	if err != nil || ttlSeconds <= 0 {
		return "", "", 0, false, errors.New("CLOUDFLARE_TURN_TTL must be a positive number of seconds")
	}
	endpoint := "https://rtc.live.cloudflare.com/v1/turn/keys/" + url.PathEscape(keyID) + "/credentials/generate-ice-servers"
	return endpoint, token, time.Duration(ttlSeconds) * time.Second, false, nil
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
