import type { CreateRoomResponse, JoinRoomResponse, Role } from '../../types';

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '');
export const API_BASE = configuredBase || window.location.origin;

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

export function createRoom(): Promise<CreateRoomResponse> {
  return request('/api/rooms', { method: 'POST', body: '{}' });
}

export function joinRoom(code: string): Promise<JoinRoomResponse> {
  return request(`/api/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST', body: '{}',
  });
}

export function websocketUrl(code: string, role: Role, token: string): string {
  const url = new URL(`${API_BASE}/api/rooms/${encodeURIComponent(code)}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', role);
  url.searchParams.set('token', token);
  return url.toString();
}
