import { createHmac, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

type Role = 'sender' | 'receiver';

interface Room {
  ownerToken: string;
  receiverToken?: string;
  status: 'waiting' | 'active';
  createdAt: number;
  expiresAt: number;
  sockets: Partial<Record<Role, WebSocket>>;
  timer: NodeJS.Timeout;
}

interface LimitState {
  windowStart: number;
  creates: number;
  joins: number;
  failures: number;
  blockedUntil: number;
  lastSeen: number;
}

const WAITING_TTL = 10 * 60 * 1000;
const ACTIVE_TTL = 2 * 60 * 60 * 1000;
const RATE_WINDOW = 10 * 60 * 1000;
const MAX_SIGNAL_BYTES = 32 * 1024;
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const rooms = new Map<string, Room>();
const limits = new Map<string, LimitState>();
const allowedByRole: Record<Role, Set<string>> = {
  sender: new Set(['join-approved', 'join-rejected', 'offer', 'ice']),
  receiver: new Set(['answer', 'ice']),
};

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function token(): string {
  return randomBytes(24).toString('base64url');
}

function roomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, value => CODE_CHARS[value % CODE_CHARS.length]).join('');
}

function requestIp(request: IncomingMessage): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (value) return value.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const configured = process.env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
  if (configured?.length) return configured.includes(origin);
  try {
    const forwardedHost = request.headers['x-forwarded-host'];
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function rateLimit(request: IncomingMessage, kind: 'create' | 'join'): boolean {
  const now = Date.now();
  const ip = requestIp(request);
  const state = limits.get(ip) || { windowStart: now, creates: 0, joins: 0, failures: 0, blockedUntil: 0, lastSeen: now };
  if (now - state.windowStart >= RATE_WINDOW) {
    state.windowStart = now;
    state.creates = 0;
    state.joins = 0;
    state.failures = 0;
  }
  state.lastSeen = now;
  if (kind === 'create') state.creates += 1;
  else state.joins += 1;
  limits.set(ip, state);
  return state.blockedUntil <= now && (kind === 'create' ? state.creates <= 10 : state.joins <= 30);
}

function recordJoinResult(request: IncomingMessage, success: boolean): void {
  const state = limits.get(requestIp(request));
  if (!state) return;
  if (success) state.failures = 0;
  else {
    state.failures += 1;
    if (state.failures >= 10) state.blockedUntil = Date.now() + 60 * 60 * 1000;
  }
}

function closeRoom(code: string, closeCode = 4000, reason = 'room-expired'): void {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.timer);
  rooms.delete(code);
  for (const socket of Object.values(room.sockets)) {
    if (socket?.readyState === WebSocket.OPEN) socket.close(closeCode, reason);
  }
}

function scheduleRoom(code: string, room: Room): void {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => closeRoom(code), Math.max(0, room.expiresAt - Date.now()));
  room.timer.unref();
}

function iceServers(request: IncomingMessage): Array<Record<string, unknown>> {
  const secret = process.env.TURN_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-turn-secret');
  if (!secret) throw new Error('TURN_SECRET is not configured');
  const requestHost = request.headers.host?.replace(/:\d+$/, '') || 'localhost';
  const host = process.env.TURN_HOST || requestHost;
  const port = Number(process.env.TURN_PORT || 3478);
  const expires = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const username = `${expires}:${randomBytes(8).toString('hex')}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return [{ urls: [`stun:${host}:${port}`, `turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`], username, credential }];
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<void> {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4096) throw new Error('request-too-large');
  }
}

function serveStatic(request: IncomingMessage, response: ServerResponse): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../dist');
  const rawPath = new URL(request.url || '/', 'http://localhost').pathname;
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { response.writeHead(400).end(); return; }
  const relative = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
  let file = join(root, relative || 'index.html');
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');
  if (!existsSync(file)) { json(response, 503, { error: '前端尚未构建' }); return; }
  const headers: Record<string, string> = { 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream' };
  headers['Cache-Control'] = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
  response.writeHead(200, headers);
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (!originAllowed(request)) { json(response, 403, { error: '不允许的来源' }); return; }
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/healthz') { json(response, 200, { ok: true }); return; }
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      await readBody(request);
      if (!rateLimit(request, 'create')) { json(response, 429, { error: '请求过于频繁，请稍后再试' }); return; }
      const servers = iceServers(request);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = roomCode();
        if (rooms.has(code)) continue;
        const createdAt = Date.now();
        const room: Room = { ownerToken: token(), status: 'waiting', createdAt, expiresAt: createdAt + WAITING_TTL, sockets: {}, timer: setTimeout(() => {}, 0) };
        scheduleRoom(code, room);
        rooms.set(code, room);
        json(response, 201, { roomCode: code, ownerToken: room.ownerToken, expiresAt: room.expiresAt, iceServers: servers });
        return;
      }
      json(response, 503, { error: '暂时无法分配房间码，请重试' });
      return;
    }
    const joinMatch = url.pathname.match(/^\/api\/rooms\/([23456789A-HJ-NP-Z]{6})\/join$/);
    if (request.method === 'POST' && joinMatch) {
      await readBody(request);
      if (!rateLimit(request, 'join')) { json(response, 429, { error: '尝试次数过多，请稍后再试' }); return; }
      const room = rooms.get(joinMatch[1]);
      if (!room || room.expiresAt <= Date.now()) {
        recordJoinResult(request, false);
        json(response, 404, { error: '房间不存在或已过期' });
        return;
      }
      if (room.receiverToken) { json(response, 409, { error: '房间已有接收方' }); return; }
      const servers = iceServers(request);
      room.receiverToken = token();
      recordJoinResult(request, true);
      json(response, 200, { receiverToken: room.receiverToken, expiresAt: room.expiresAt, iceServers: servers });
      return;
    }
    if (url.pathname.startsWith('/api/')) { json(response, 404, { error: 'Not found' }); return; }
    if (request.method === 'GET' || request.method === 'HEAD') { serveStatic(request, response); return; }
    json(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('request failed', error);
    json(response, error instanceof Error && error.message === 'request-too-large' ? 413 : 500, { error: '服务暂时不可用' });
  }
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_SIGNAL_BYTES });

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (request, socket, head) => {
  if (!originAllowed(request)) { rejectUpgrade(socket, 403, 'Forbidden'); return; }
  const url = new URL(request.url || '/', 'http://localhost');
  const match = url.pathname.match(/^\/api\/rooms\/([23456789A-HJ-NP-Z]{6})\/ws$/);
  if (!match) { rejectUpgrade(socket, 404, 'Not Found'); return; }
  const room = rooms.get(match[1]);
  const role = url.searchParams.get('role') as Role;
  const suppliedToken = url.searchParams.get('token') || '';
  const valid = room && room.expiresAt > Date.now() && ((role === 'sender' && suppliedToken === room.ownerToken) || (role === 'receiver' && suppliedToken === room.receiverToken));
  if (!valid) { rejectUpgrade(socket, 401, 'Unauthorized'); return; }
  if (room.sockets[role]) { rejectUpgrade(socket, 409, 'Conflict'); return; }
  websocketServer.handleUpgrade(request, socket, head, ws => websocketServer.emit('connection', ws, request, match[1], role));
});

websocketServer.on('connection', (socket: WebSocket, _request: IncomingMessage, code: string, role: Role) => {
  const room = rooms.get(code);
  if (!room) { socket.close(4000, 'room-expired'); return; }
  room.sockets[role] = socket;
  const otherRole: Role = role === 'sender' ? 'receiver' : 'sender';
  if (role === 'receiver' && room.sockets.sender?.readyState === WebSocket.OPEN) room.sockets.sender.send(JSON.stringify({ type: 'join-request' }));
  if (role === 'sender' && room.receiverToken) socket.send(JSON.stringify({ type: 'join-request' }));

  socket.on('message', (data, isBinary) => {
    const messageBytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
    if (isBinary || messageBytes > MAX_SIGNAL_BYTES) { socket.close(1008, 'invalid-message'); return; }
    const raw = Array.isArray(data) ? Buffer.concat(data).toString() : data.toString();
    let message: Record<string, any>;
    try { message = JSON.parse(raw); } catch { socket.close(1008, 'invalid-json'); return; }
    if (typeof message.type !== 'string' || !allowedByRole[role].has(message.type)) {
      socket.send(JSON.stringify({ type: 'error', code: '不允许的信令消息' }));
      return;
    }
    if ((message.type === 'offer' || message.type === 'answer') && typeof message.description?.sdp !== 'string') return;
    if (message.type === 'ice' && typeof message.candidate?.candidate !== 'string') return;
    const current = rooms.get(code);
    if (!current) return;
    if (message.type === 'join-rejected' && role === 'sender') {
      const receiver = current.sockets.receiver;
      if (receiver?.readyState === WebSocket.OPEN) receiver.send(raw);
      delete current.receiverToken;
      current.status = 'waiting';
      receiver?.close(4003, 'rejected');
      return;
    }
    if (message.type === 'join-approved' && role === 'sender') {
      current.status = 'active';
      current.expiresAt = Math.min(current.createdAt + ACTIVE_TTL, Date.now() + ACTIVE_TTL);
      scheduleRoom(code, current);
    }
    const peer = current.sockets[otherRole];
    if (peer?.readyState === WebSocket.OPEN) peer.send(raw);
  });

  socket.on('close', () => {
    const current = rooms.get(code);
    if (!current || current.sockets[role] !== socket) return;
    delete current.sockets[role];
    const peer = current.sockets[otherRole];
    if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'peer-left' }));
    if (role === 'sender') closeRoom(code, 4001, 'sender-left');
    else {
      delete current.receiverToken;
      current.status = 'waiting';
      current.expiresAt = Date.now() + WAITING_TTL;
      scheduleRoom(code, current);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [ip, state] of limits) if (state.lastSeen < cutoff && state.blockedUntil < Date.now()) limits.delete(ip);
}, 10 * 60 * 1000).unref();

const port = Number(process.env.PORT || 8080);
server.listen(port, '0.0.0.0', () => console.log(`AirDrop-Lite listening on http://0.0.0.0:${port}`));

function shutdown(): void {
  for (const code of rooms.keys()) closeRoom(code, 1001, 'server-shutdown');
  websocketServer.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { server };
