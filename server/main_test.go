package main

import (
	"strings"
	"testing"
	"time"
)

func TestCloudflareTurnConfig(t *testing.T) {
	t.Setenv("CLOUDFLARE_TURN_KEY_ID", "test/key")
	t.Setenv("CLOUDFLARE_TURN_API_TOKEN", "test-token")
	t.Setenv("CLOUDFLARE_TURN_TTL", "3600")
	endpoint, token, ttl, stunOnly, err := cloudflareTurnConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(endpoint, "/test%2Fkey/credentials/generate-ice-servers") {
		t.Fatalf("TURN endpoint = %q", endpoint)
	}
	if token != "test-token" || ttl != time.Hour || stunOnly {
		t.Fatalf("TURN config token=%q ttl=%s stunOnly=%t", token, ttl, stunOnly)
	}
}

func TestCloudflareTurnConfigRequiresCredentials(t *testing.T) {
	t.Setenv("CLOUDFLARE_TURN_KEY_ID", "")
	t.Setenv("CLOUDFLARE_TURN_API_TOKEN", "")
	t.Setenv("NODE_ENV", "production")
	if _, _, _, _, err := cloudflareTurnConfig(); err == nil {
		t.Fatal("missing Cloudflare TURN credentials were accepted")
	}

	t.Setenv("CLOUDFLARE_TURN_KEY_ID", "test-key")
	t.Setenv("CLOUDFLARE_TURN_API_TOKEN", "test-token")
	t.Setenv("CLOUDFLARE_TURN_TTL", "invalid")
	if _, _, _, _, err := cloudflareTurnConfig(); err == nil {
		t.Fatal("invalid Cloudflare TURN TTL was accepted")
	}
}

func TestCloudflareTurnConfigAllowsLocalStunOnlyMode(t *testing.T) {
	t.Setenv("NODE_ENV", "")
	t.Setenv("CLOUDFLARE_TURN_KEY_ID", "")
	t.Setenv("CLOUDFLARE_TURN_API_TOKEN", "")
	endpoint, token, ttl, stunOnly, err := cloudflareTurnConfig()
	if err != nil || endpoint != "" || token != "" || ttl != defaultTurnTTL || !stunOnly {
		t.Fatalf("local TURN config endpoint=%q token=%q ttl=%s stunOnly=%t err=%v", endpoint, token, ttl, stunOnly, err)
	}
}
