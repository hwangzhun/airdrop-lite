package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	defaultWaitingTTL = 10 * time.Minute
	defaultActiveTTL  = 2 * time.Hour
	defaultRateWindow = 10 * time.Minute
	defaultTurnTTL    = 2 * time.Hour
	maxSignalBytes    = 32 * 1024
	maxTurnResponse   = 64 * 1024
	codeChars         = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

type role string

const (
	senderRole   role = "sender"
	receiverRole role = "receiver"
)

type client struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func (c *client) writeJSON(value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteJSON(value)
}

func (c *client) writeRaw(data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *client) close(code int, reason string) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
	_ = c.conn.Close()
}

type room struct {
	ownerToken    string
	receiverToken string
	status        string
	createdAt     time.Time
	expiresAt     time.Time
	clients       map[role]*client
	timer         *time.Timer
}

type limitState struct {
	windowStart  time.Time
	creates      int
	joins        int
	failures     int
	blockedUntil time.Time
	lastSeen     time.Time
}

type appConfig struct {
	staticDir          string
	waitingTTL         time.Duration
	activeTTL          time.Duration
	rateWindow         time.Duration
	turnCredentialsURL string
	turnAPIToken       string
	turnTTL            time.Duration
	stunOnly           bool
	httpClient         *http.Client
}

type application struct {
	mu          sync.Mutex
	rooms       map[string]*room
	limits      map[string]*limitState
	config      appConfig
	upgrader    websocket.Upgrader
	stopCleanup chan struct{}
}

func newApplication(config appConfig) *application {
	if config.staticDir == "" {
		config.staticDir = "dist"
	}
	if config.waitingTTL == 0 {
		config.waitingTTL = defaultWaitingTTL
	}
	if config.activeTTL == 0 {
		config.activeTTL = defaultActiveTTL
	}
	if config.rateWindow == 0 {
		config.rateWindow = defaultRateWindow
	}
	if config.turnTTL == 0 {
		config.turnTTL = defaultTurnTTL
	}
	if config.httpClient == nil {
		config.httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	app := &application{
		rooms:       make(map[string]*room),
		limits:      make(map[string]*limitState),
		config:      config,
		upgrader:    websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }},
		stopCleanup: make(chan struct{}),
	}
	go app.cleanupLimits()
	return app
}

func (app *application) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	// Origin validation protects state-changing API and WebSocket requests. Static
	// ES modules can legitimately include an Origin header (Vite marks its entry
	// script as crossorigin), so applying this check globally can make the HTML
	// load while its JS and CSS fail with 403.
	if strings.HasPrefix(request.URL.Path, "/api/") && !originAllowed(request) {
		writeJSON(response, http.StatusForbidden, map[string]string{"error": "不允许的来源"})
		return
	}

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/healthz":
		writeJSON(response, http.StatusOK, map[string]bool{"ok": true})
	case request.Method == http.MethodPost && request.URL.Path == "/api/rooms":
		app.createRoom(response, request)
	case request.Method == http.MethodPost && strings.HasPrefix(request.URL.Path, "/api/rooms/") && strings.HasSuffix(request.URL.Path, "/join"):
		app.joinRoom(response, request)
	case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/api/rooms/") && strings.HasSuffix(request.URL.Path, "/ws"):
		app.connectWebSocket(response, request)
	case strings.HasPrefix(request.URL.Path, "/api/"):
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "Not found"})
	case request.Method == http.MethodGet || request.Method == http.MethodHead:
		app.serveStatic(response, request)
	default:
		writeJSON(response, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}

func (app *application) createRoom(response http.ResponseWriter, request *http.Request) {
	if err := consumeSmallBody(request); err != nil {
		writeJSON(response, http.StatusRequestEntityTooLarge, map[string]string{"error": "服务暂时不可用"})
		return
	}
	if !app.allowRequest(request, "create") {
		writeJSON(response, http.StatusTooManyRequests, map[string]string{"error": "请求过于频繁，请稍后再试"})
		return
	}
	servers, err := app.iceServers(request)
	if err != nil {
		log.Printf("get Cloudflare TURN credentials: %v", err)
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "服务暂时不可用"})
		return
	}

	for attempt := 0; attempt < 8; attempt++ {
		code, err := randomRoomCode()
		if err != nil {
			break
		}
		ownerToken, err := randomToken()
		if err != nil {
			break
		}
		now := time.Now()
		created := &room{ownerToken: ownerToken, status: "waiting", createdAt: now, expiresAt: now.Add(app.config.waitingTTL), clients: make(map[role]*client)}
		app.mu.Lock()
		if _, exists := app.rooms[code]; exists {
			app.mu.Unlock()
			continue
		}
		app.rooms[code] = created
		app.scheduleRoomLocked(code, created)
		app.mu.Unlock()
		writeJSON(response, http.StatusCreated, map[string]any{
			"roomCode": code, "ownerToken": ownerToken, "expiresAt": created.expiresAt.UnixMilli(), "iceServers": servers,
		})
		return
	}
	writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "暂时无法分配房间码，请重试"})
}

func (app *application) joinRoom(response http.ResponseWriter, request *http.Request) {
	code, ok := roomCodeFromPath(request.URL.Path, "/join")
	if !ok {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	if err := consumeSmallBody(request); err != nil {
		writeJSON(response, http.StatusRequestEntityTooLarge, map[string]string{"error": "服务暂时不可用"})
		return
	}
	if !app.allowRequest(request, "join") {
		writeJSON(response, http.StatusTooManyRequests, map[string]string{"error": "尝试次数过多，请稍后再试"})
		return
	}
	app.mu.Lock()
	current := app.rooms[code]
	if current == nil || !current.expiresAt.After(time.Now()) {
		app.mu.Unlock()
		app.recordJoinResult(request, false)
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "房间不存在或已过期"})
		return
	}
	if current.receiverToken != "" {
		app.mu.Unlock()
		writeJSON(response, http.StatusConflict, map[string]string{"error": "房间已有接收方"})
		return
	}
	app.mu.Unlock()

	servers, err := app.iceServers(request)
	if err != nil {
		log.Printf("get Cloudflare TURN credentials: %v", err)
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "服务暂时不可用"})
		return
	}
	receiverToken, err := randomToken()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "服务暂时不可用"})
		return
	}

	app.mu.Lock()
	current = app.rooms[code]
	if current == nil || !current.expiresAt.After(time.Now()) {
		app.mu.Unlock()
		app.recordJoinResult(request, false)
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "房间不存在或已过期"})
		return
	}
	if current.receiverToken != "" {
		app.mu.Unlock()
		writeJSON(response, http.StatusConflict, map[string]string{"error": "房间已有接收方"})
		return
	}
	current.receiverToken = receiverToken
	expiresAt := current.expiresAt.UnixMilli()
	app.mu.Unlock()
	app.recordJoinResult(request, true)
	writeJSON(response, http.StatusOK, map[string]any{"receiverToken": receiverToken, "expiresAt": expiresAt, "iceServers": servers})
}

func (app *application) connectWebSocket(response http.ResponseWriter, request *http.Request) {
	code, ok := roomCodeFromPath(request.URL.Path, "/ws")
	if !ok {
		http.Error(response, "Not Found", http.StatusNotFound)
		return
	}
	requestedRole := role(request.URL.Query().Get("role"))
	token := request.URL.Query().Get("token")

	app.mu.Lock()
	current := app.rooms[code]
	valid := current != nil && current.expiresAt.After(time.Now()) &&
		((requestedRole == senderRole && token == current.ownerToken) || (requestedRole == receiverRole && token == current.receiverToken && token != ""))
	if !valid {
		app.mu.Unlock()
		http.Error(response, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if current.clients[requestedRole] != nil {
		app.mu.Unlock()
		http.Error(response, "Conflict", http.StatusConflict)
		return
	}
	app.mu.Unlock()

	connection, err := app.upgrader.Upgrade(response, request, nil)
	if err != nil {
		return
	}
	connection.SetReadLimit(maxSignalBytes)
	connected := &client{conn: connection}

	app.mu.Lock()
	current = app.rooms[code]
	valid = current != nil && current.expiresAt.After(time.Now()) &&
		((requestedRole == senderRole && token == current.ownerToken) || (requestedRole == receiverRole && token == current.receiverToken && token != ""))
	if !valid || current.clients[requestedRole] != nil {
		app.mu.Unlock()
		connected.close(websocket.ClosePolicyViolation, "room-unavailable")
		return
	}
	current.clients[requestedRole] = connected
	sender := current.clients[senderRole]
	shouldNotifySender := requestedRole == receiverRole && sender != nil
	shouldNotifyNewSender := requestedRole == senderRole && current.receiverToken != ""
	app.mu.Unlock()

	if shouldNotifySender {
		_ = sender.writeJSON(map[string]string{"type": "join-request"})
	}
	if shouldNotifyNewSender {
		_ = connected.writeJSON(map[string]string{"type": "join-request"})
	}

	app.readSignals(code, requestedRole, connected)
}

func (app *application) readSignals(code string, currentRole role, connected *client) {
	defer app.disconnectClient(code, currentRole, connected)
	allowed := map[role]map[string]bool{
		senderRole:   {"join-approved": true, "join-rejected": true, "offer": true, "ice": true},
		receiverRole: {"answer": true, "ice": true},
	}

	for {
		messageType, raw, err := connected.conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage || len(raw) > maxSignalBytes {
			connected.close(websocket.ClosePolicyViolation, "invalid-message")
			return
		}
		var message map[string]any
		if json.Unmarshal(raw, &message) != nil {
			connected.close(websocket.ClosePolicyViolation, "invalid-json")
			return
		}
		kind, ok := message["type"].(string)
		if !ok || !allowed[currentRole][kind] {
			_ = connected.writeJSON(map[string]string{"type": "error", "code": "不允许的信令消息"})
			continue
		}
		if (kind == "offer" || kind == "answer") && !nestedString(message, "description", "sdp") {
			continue
		}
		if kind == "ice" && !nestedString(message, "candidate", "candidate") {
			continue
		}

		otherRole := senderRole
		if currentRole == senderRole {
			otherRole = receiverRole
		}
		app.mu.Lock()
		current := app.rooms[code]
		if current == nil || current.clients[currentRole] != connected {
			app.mu.Unlock()
			return
		}
		peer := current.clients[otherRole]
		if kind == "join-rejected" && currentRole == senderRole {
			current.receiverToken = ""
			current.status = "waiting"
			delete(current.clients, receiverRole)
			app.mu.Unlock()
			if peer != nil {
				_ = peer.writeRaw(raw)
				peer.close(4003, "rejected")
			}
			continue
		}
		if kind == "join-approved" && currentRole == senderRole {
			current.status = "active"
			candidate := time.Now().Add(app.config.activeTTL)
			maximum := current.createdAt.Add(app.config.activeTTL)
			if candidate.After(maximum) {
				candidate = maximum
			}
			current.expiresAt = candidate
			app.scheduleRoomLocked(code, current)
		}
		app.mu.Unlock()
		if peer != nil {
			_ = peer.writeRaw(raw)
		}
	}
}

func (app *application) disconnectClient(code string, disconnectedRole role, disconnected *client) {
	otherRole := senderRole
	if disconnectedRole == senderRole {
		otherRole = receiverRole
	}
	app.mu.Lock()
	current := app.rooms[code]
	if current == nil || current.clients[disconnectedRole] != disconnected {
		app.mu.Unlock()
		return
	}
	delete(current.clients, disconnectedRole)
	peer := current.clients[otherRole]
	var closeClients []*client
	if disconnectedRole == senderRole {
		closeClients = app.removeRoomLocked(code, current)
	} else {
		current.receiverToken = ""
		current.status = "waiting"
		current.expiresAt = time.Now().Add(app.config.waitingTTL)
		app.scheduleRoomLocked(code, current)
	}
	app.mu.Unlock()
	if peer != nil {
		_ = peer.writeJSON(map[string]string{"type": "peer-left"})
	}
	for _, item := range closeClients {
		if item != disconnected {
			item.close(4001, "sender-left")
		}
	}
}

func (app *application) scheduleRoomLocked(code string, current *room) {
	if current.timer != nil {
		current.timer.Stop()
	}
	delay := time.Until(current.expiresAt)
	if delay < 0 {
		delay = 0
	}
	current.timer = time.AfterFunc(delay, func() { app.closeRoom(code, 4000, "room-expired") })
}

func (app *application) removeRoomLocked(code string, current *room) []*client {
	if current.timer != nil {
		current.timer.Stop()
	}
	delete(app.rooms, code)
	clients := make([]*client, 0, len(current.clients))
	for _, item := range current.clients {
		clients = append(clients, item)
	}
	return clients
}

func (app *application) closeRoom(code string, closeCode int, reason string) {
	app.mu.Lock()
	current := app.rooms[code]
	if current == nil {
		app.mu.Unlock()
		return
	}
	clients := app.removeRoomLocked(code, current)
	app.mu.Unlock()
	for _, item := range clients {
		item.close(closeCode, reason)
	}
}

func (app *application) shutdown() {
	select {
	case <-app.stopCleanup:
	default:
		close(app.stopCleanup)
	}
	app.mu.Lock()
	codes := make([]string, 0, len(app.rooms))
	for code := range app.rooms {
		codes = append(codes, code)
	}
	app.mu.Unlock()
	for _, code := range codes {
		app.closeRoom(code, websocket.CloseGoingAway, "server-shutdown")
	}
}

func (app *application) allowRequest(request *http.Request, kind string) bool {
	now := time.Now()
	ip := requestIP(request)
	app.mu.Lock()
	defer app.mu.Unlock()
	state := app.limits[ip]
	if state == nil {
		state = &limitState{windowStart: now}
		app.limits[ip] = state
	}
	if now.Sub(state.windowStart) >= app.config.rateWindow {
		state.windowStart, state.creates, state.joins, state.failures = now, 0, 0, 0
	}
	state.lastSeen = now
	if kind == "create" {
		state.creates++
	} else {
		state.joins++
	}
	return !state.blockedUntil.After(now) && ((kind == "create" && state.creates <= 10) || (kind == "join" && state.joins <= 30))
}

func (app *application) recordJoinResult(request *http.Request, success bool) {
	app.mu.Lock()
	defer app.mu.Unlock()
	state := app.limits[requestIP(request)]
	if state == nil {
		return
	}
	if success {
		state.failures = 0
		return
	}
	state.failures++
	if state.failures >= 10 {
		state.blockedUntil = time.Now().Add(time.Hour)
	}
}

func (app *application) cleanupLimits() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			cutoff := time.Now().Add(-2 * time.Hour)
			app.mu.Lock()
			for ip, state := range app.limits {
				if state.lastSeen.Before(cutoff) && state.blockedUntil.Before(time.Now()) {
					delete(app.limits, ip)
				}
			}
			app.mu.Unlock()
		case <-app.stopCleanup:
			return
		}
	}
}

func (app *application) serveStatic(response http.ResponseWriter, request *http.Request) {
	cleaned := filepath.Clean("/" + request.URL.Path)
	relative := strings.TrimPrefix(cleaned, "/")
	if relative == "" || relative == "." {
		relative = "index.html"
	}
	root, err := filepath.Abs(app.config.staticDir)
	if err != nil {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "前端尚未构建"})
		return
	}
	file := filepath.Join(root, relative)
	if !strings.HasPrefix(file, root+string(os.PathSeparator)) && file != root {
		file = filepath.Join(root, "index.html")
	}
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		file = filepath.Join(root, "index.html")
		if info, err = os.Stat(file); err != nil || !info.Mode().IsRegular() {
			writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "前端尚未构建"})
			return
		}
	}
	contentType := mime.TypeByExtension(filepath.Ext(file))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	response.Header().Set("Content-Type", contentType)
	if filepath.Base(file) == "index.html" {
		response.Header().Set("Cache-Control", "no-cache")
	} else {
		response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeFile(response, request, file)
}

func (app *application) iceServers(request *http.Request) ([]map[string]any, error) {
	if app.config.stunOnly {
		return []map[string]any{{"urls": []string{"stun:stun.cloudflare.com:3478"}}}, nil
	}
	if app.config.turnCredentialsURL == "" || app.config.turnAPIToken == "" {
		return nil, errors.New("Cloudflare TURN credentials are not configured")
	}
	payload, err := json.Marshal(map[string]int64{"ttl": int64(app.config.turnTTL.Seconds())})
	if err != nil {
		return nil, err
	}
	turnRequest, err := http.NewRequestWithContext(request.Context(), http.MethodPost, app.config.turnCredentialsURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	turnRequest.Header.Set("Authorization", "Bearer "+app.config.turnAPIToken)
	turnRequest.Header.Set("Content-Type", "application/json")

	response, err := app.config.httpClient.Do(turnRequest)
	if err != nil {
		return nil, fmt.Errorf("request credentials: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxTurnResponse))
		return nil, fmt.Errorf("credentials endpoint returned %s", response.Status)
	}
	var decoded struct {
		ICEServers []map[string]any `json:"iceServers"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxTurnResponse))
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode credentials: %w", err)
	}
	if len(decoded.ICEServers) == 0 {
		return nil, errors.New("credentials response contains no ICE servers")
	}
	return decoded.ICEServers, nil
}

func originAllowed(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	if origin == "" {
		return true
	}
	originRequest, err := http.NewRequest(http.MethodGet, origin, nil)
	if err != nil || originRequest.URL.Host == "" {
		return false
	}
	host := request.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = request.Host
	}
	proto := request.Header.Get("X-Forwarded-Proto")
	if comma := strings.IndexByte(proto, ','); comma >= 0 {
		proto = proto[:comma]
	}
	proto = strings.TrimSpace(proto)
	if proto == "" {
		if request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	// The public request's own origin is always valid. ALLOWED_ORIGINS adds
	// trusted origins; it must not accidentally deny the site itself.
	if strings.EqualFold(originRequest.URL.Scheme, proto) && strings.EqualFold(originRequest.URL.Host, host) {
		return true
	}
	if configured := splitNonEmpty(os.Getenv("ALLOWED_ORIGINS")); len(configured) > 0 {
		for _, allowed := range configured {
			if strings.EqualFold(strings.TrimRight(origin, "/"), strings.TrimRight(allowed, "/")) {
				return true
			}
		}
	}
	return false
}

func requestIP(request *http.Request) string {
	if os.Getenv("TRUST_PROXY") == "true" {
		if forwarded := request.Header.Get("X-Forwarded-For"); forwarded != "" {
			return strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	if request.RemoteAddr == "" {
		return "unknown"
	}
	return request.RemoteAddr
}

func randomToken() (string, error) {
	data := make([]byte, 24)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func randomRoomCode() (string, error) {
	data := make([]byte, 6)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	result := make([]byte, len(data))
	for index, value := range data {
		result[index] = codeChars[int(value)%len(codeChars)]
	}
	return string(result), nil
}

func roomCodeFromPath(path, suffix string) (string, bool) {
	prefix := "/api/rooms/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	code := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if len(code) != 6 {
		return "", false
	}
	for _, character := range code {
		if !strings.ContainsRune(codeChars, character) {
			return "", false
		}
	}
	return code, true
}

func consumeSmallBody(request *http.Request) error {
	defer request.Body.Close()
	limited := io.LimitReader(request.Body, 4097)
	data, err := io.ReadAll(limited)
	if err != nil {
		return err
	}
	if len(data) > 4096 {
		return errors.New("request-too-large")
	}
	return nil
}

func nestedString(message map[string]any, parent, child string) bool {
	value, ok := message[parent].(map[string]any)
	if !ok {
		return false
	}
	_, ok = value[child].(string)
	return ok
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}

func splitNonEmpty(value string) []string {
	parts := strings.Split(value, ",")
	result := parts[:0]
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
