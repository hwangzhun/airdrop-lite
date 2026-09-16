package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type roomResponse struct {
	RoomCode      string           `json:"roomCode"`
	OwnerToken    string           `json:"ownerToken"`
	ReceiverToken string           `json:"receiverToken"`
	ExpiresAt     int64            `json:"expiresAt"`
	ICEServers    []map[string]any `json:"iceServers"`
}

func newTestServer(t *testing.T, config appConfig) (*application, *httptest.Server) {
	t.Helper()
	t.Setenv("TURN_HOST", "turn.example.test")
	t.Setenv("TURN_SECRET", "test-secret-for-temporary-credentials")
	app := newApplication(config)
	server := httptest.NewServer(app)
	t.Cleanup(func() {
		server.Close()
		app.shutdown()
	})
	return app, server
}

func requestJSON(t *testing.T, method, address, body string) (*http.Response, roomResponse) {
	t.Helper()
	request, err := http.NewRequest(method, address, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var decoded roomResponse
	_ = json.NewDecoder(response.Body).Decode(&decoded)
	return response, decoded
}

func createTestRoom(t *testing.T, baseURL string) roomResponse {
	t.Helper()
	response, created := requestJSON(t, http.MethodPost, baseURL+"/api/rooms", "{}")
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create room status = %d", response.StatusCode)
	}
	return created
}

func TestHealthAndStaticFiles(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<h1>AirDrop-Lite</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staticDir, "app.js"), []byte("export{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, server := newTestServer(t, appConfig{staticDir: staticDir})

	response, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("health response = %d, cache = %q", response.StatusCode, response.Header.Get("Cache-Control"))
	}

	response, err = http.Get(server.URL + "/unknown/client/route")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "AirDrop-Lite") || response.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("SPA fallback failed: %d %q", response.StatusCode, body)
	}

	response, err = http.Get(server.URL + "/app.js")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if !strings.Contains(response.Header.Get("Cache-Control"), "immutable") {
		t.Fatalf("asset cache header = %q", response.Header.Get("Cache-Control"))
	}
}

func TestCreatesRoomAndReturnsTurnCredentials(t *testing.T) {
	_, server := newTestServer(t, appConfig{})
	created := createTestRoom(t, server.URL)
	if len(created.RoomCode) != 6 || len(created.OwnerToken) != 32 || created.ExpiresAt <= time.Now().UnixMilli() {
		t.Fatalf("invalid room response: %+v", created)
	}
	if len(created.ICEServers) != 1 {
		t.Fatalf("ICE servers = %#v", created.ICEServers)
	}
	urls, ok := created.ICEServers[0]["urls"].([]any)
	if !ok || !containsAnyString(urls, "turn:turn.example.test:3478?transport=udp") {
		t.Fatalf("TURN URLs = %#v", created.ICEServers[0]["urls"])
	}
	if username, _ := created.ICEServers[0]["username"].(string); !strings.Contains(username, ":") {
		t.Fatalf("TURN username = %q", username)
	}
}

func TestJoinRejectsMissingAndSecondReceiver(t *testing.T) {
	_, server := newTestServer(t, appConfig{})
	response, _ := requestJSON(t, http.MethodPost, server.URL+"/api/rooms/AAAAAA/join", "{}")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("missing room status = %d", response.StatusCode)
	}
	created := createTestRoom(t, server.URL)
	response, joined := requestJSON(t, http.MethodPost, server.URL+"/api/rooms/"+created.RoomCode+"/join", "{}")
	if response.StatusCode != http.StatusOK || len(joined.ReceiverToken) != 32 {
		t.Fatalf("join response = %d %+v", response.StatusCode, joined)
	}
	response, _ = requestJSON(t, http.MethodPost, server.URL+"/api/rooms/"+created.RoomCode+"/join", "{}")
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("second join status = %d", response.StatusCode)
	}
}

func TestWebSocketAuthenticationAndSignalRelay(t *testing.T) {
	_, server := newTestServer(t, appConfig{})
	created := createTestRoom(t, server.URL)
	_, joined := requestJSON(t, http.MethodPost, server.URL+"/api/rooms/"+created.RoomCode+"/join", "{}")
	wsBase := "ws" + strings.TrimPrefix(server.URL, "http")

	_, response, err := websocket.DefaultDialer.Dial(wsBase+"/api/rooms/"+created.RoomCode+"/ws?role=sender&token=bad", nil)
	if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("invalid token result: response=%v err=%v", response, err)
	}

	sender, _, err := websocket.DefaultDialer.Dial(wsBase+"/api/rooms/"+created.RoomCode+"/ws?role=sender&token="+url.QueryEscape(created.OwnerToken), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	receiver, _, err := websocket.DefaultDialer.Dial(wsBase+"/api/rooms/"+created.RoomCode+"/ws?role=receiver&token="+url.QueryEscape(joined.ReceiverToken), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer receiver.Close()

	assertMessageType(t, sender, "join-request")
	if err := sender.WriteJSON(map[string]string{"type": "join-approved"}); err != nil {
		t.Fatal(err)
	}
	assertMessageType(t, receiver, "join-approved")
	if err := receiver.WriteJSON(map[string]any{"type": "offer", "description": map[string]string{"sdp": "not allowed"}}); err != nil {
		t.Fatal(err)
	}
	var rejected map[string]any
	if err := receiver.ReadJSON(&rejected); err != nil {
		t.Fatal(err)
	}
	if rejected["type"] != "error" || rejected["code"] != "不允许的信令消息" {
		t.Fatalf("unexpected rejection: %#v", rejected)
	}
	if err := sender.WriteJSON(map[string]any{"type": "offer", "description": map[string]string{"sdp": "v=0"}}); err != nil {
		t.Fatal(err)
	}
	assertMessageType(t, receiver, "offer")
}

func TestReceiverDisconnectAllowsReplacement(t *testing.T) {
	_, server := newTestServer(t, appConfig{})
	created := createTestRoom(t, server.URL)
	_, joined := requestJSON(t, http.MethodPost, server.URL+"/api/rooms/"+created.RoomCode+"/join", "{}")
	wsBase := "ws" + strings.TrimPrefix(server.URL, "http")
	receiver, _, err := websocket.DefaultDialer.Dial(wsBase+"/api/rooms/"+created.RoomCode+"/ws?role=receiver&token="+url.QueryEscape(joined.ReceiverToken), nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = receiver.Close()

	deadline := time.Now().Add(2 * time.Second)
	for {
		response, replacement := requestJSON(t, http.MethodPost, server.URL+"/api/rooms/"+created.RoomCode+"/join", "{}")
		if response.StatusCode == http.StatusOK {
			if len(replacement.ReceiverToken) != 32 || replacement.ReceiverToken == joined.ReceiverToken {
				t.Fatalf("invalid replacement token: %+v", replacement)
			}
			return
		}
		if response.StatusCode != http.StatusConflict || time.Now().After(deadline) {
			t.Fatalf("replacement join status = %d", response.StatusCode)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestOriginBodyLimitRateLimitAndExpiry(t *testing.T) {
	_, server := newTestServer(t, appConfig{waitingTTL: 30 * time.Millisecond})

	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/rooms", strings.NewReader("{}"))
	request.Header.Set("Origin", "https://evil.example")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("origin status = %d", response.StatusCode)
	}

	response, _ = requestJSON(t, http.MethodPost, server.URL+"/api/rooms", strings.Repeat("x", 4097))
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("large body status = %d", response.StatusCode)
	}

	created := createTestRoom(t, server.URL)
	time.Sleep(60 * time.Millisecond)
	response, _ = requestJSON(t, http.MethodPost, server.URL+"/api/rooms/"+created.RoomCode+"/join", "{}")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("expired room status = %d", response.StatusCode)
	}

	for index := 0; index < 9; index++ { // the successfully created expiring room consumed the first request
		response, _ = requestJSON(t, http.MethodPost, server.URL+"/api/rooms", "{}")
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("create %d status = %d", index, response.StatusCode)
		}
	}
	response, _ = requestJSON(t, http.MethodPost, server.URL+"/api/rooms", "{}")
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("rate-limited status = %d", response.StatusCode)
	}
}

func assertMessageType(t *testing.T, connection *websocket.Conn, expected string) {
	t.Helper()
	_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
	var message map[string]any
	if err := connection.ReadJSON(&message); err != nil {
		t.Fatal(err)
	}
	if message["type"] != expected {
		t.Fatalf("message type = %v, want %s", message["type"], expected)
	}
}

func containsAnyString(values []any, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
