package main

import (
	"strings"
	"testing"
)

func TestValidateTurnEnvironment(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("TURN_HOST", "turn.example.test")
	t.Setenv("TURN_SECRET", "too-short")
	if err := validateTurnEnvironment(); err == nil {
		t.Fatal("short production TURN secret was accepted")
	}

	t.Setenv("TURN_SECRET", "test-secret-long-enough-for-production")
	if err := validateTurnEnvironment(); err != nil {
		t.Fatalf("valid TURN environment rejected: %v", err)
	}
}

func TestTurnCommandUsesSharedSecretAuthentication(t *testing.T) {
	t.Setenv("TURN_HOST", "turn.example.test")
	t.Setenv("TURN_SECRET", "test-secret-long-enough-for-production")
	arguments := strings.Join(turnCommand().Args, " ")
	if !strings.Contains(arguments, "--use-auth-secret") {
		t.Fatalf("turnserver arguments do not enable shared-secret authentication: %s", arguments)
	}
	for _, unwanted := range []string{"--no-cli", "--lt-cred-mech"} {
		if strings.Contains(arguments, unwanted) {
			t.Fatalf("turnserver arguments contain obsolete option %q: %s", unwanted, arguments)
		}
	}
}
