import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

let server: import('node:http').Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.PORT = '0';
  process.env.TURN_HOST = 'turn.example.test';
  process.env.TURN_SECRET = 'test-secret-for-temporary-credentials';
  ({ server } = await import('../server/src/index.js'));
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once('message', data => resolve(JSON.parse(data.toString())));
    socket.once('error', reject);
  });
}

describe('self-hosted signaling server', () => {
  it('creates a room and returns temporary self-hosted TURN credentials', async () => {
    const response = await fetch(`${baseUrl}/api/rooms`, { method: 'POST', body: '{}' });
    const room = await response.json() as any;
    expect(response.status).toBe(201);
    expect(room.roomCode).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(room.ownerToken).toHaveLength(32);
    expect(room.iceServers[0].urls).toContain('turn:turn.example.test:3478?transport=udp');
    expect(room.iceServers[0].username).toMatch(/^\d+:/);
    expect(room.iceServers[0].credential).toBeTruthy();
  });

  it('authenticates both roles and relays only allowed signaling messages', async () => {
    const created = await (await fetch(`${baseUrl}/api/rooms`, { method: 'POST', body: '{}' })).json() as any;
    const joinedResponse = await fetch(`${baseUrl}/api/rooms/${created.roomCode}/join`, { method: 'POST', body: '{}' });
    const joined = await joinedResponse.json() as any;
    expect(joinedResponse.status).toBe(200);

    const wsBase = baseUrl.replace('http:', 'ws:');
    const sender = new WebSocket(`${wsBase}/api/rooms/${created.roomCode}/ws?role=sender&token=${created.ownerToken}`);
    await new Promise<void>((resolve, reject) => { sender.once('open', resolve); sender.once('error', reject); });
    const joinRequest = nextMessage(sender);
    const receiver = new WebSocket(`${wsBase}/api/rooms/${created.roomCode}/ws?role=receiver&token=${joined.receiverToken}`);
    await new Promise<void>((resolve, reject) => { receiver.once('open', resolve); receiver.once('error', reject); });
    expect(await joinRequest).toEqual({ type: 'join-request' });

    const approved = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'join-approved' }));
    expect(await approved).toEqual({ type: 'join-approved' });

    const error = nextMessage(receiver);
    receiver.send(JSON.stringify({ type: 'offer', description: { sdp: 'not allowed' } }));
    expect(await error).toEqual({ type: 'error', code: '不允许的信令消息' });
    sender.close();
    receiver.close();
  });
});
