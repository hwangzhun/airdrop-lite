export type Role = 'sender' | 'receiver';
export type TransferRoute = 'direct' | 'relay' | 'unknown';

export interface TransferManifest {
  version: 1;
  transferId: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  chunkSize: 32768;
}

export type ControlMessage =
  | { type: 'manifest'; manifest: TransferManifest }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'complete' }
  | { type: 'verified'; ok: boolean; actualHash: string }
  | { type: 'cancel'; reason: string };

export type SignalMessage =
  | { type: 'join-request' }
  | { type: 'join-approved' }
  | { type: 'join-rejected' }
  | { type: 'offer'; description: RTCSessionDescriptionInit }
  | { type: 'answer'; description: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'peer-left' }
  | { type: 'error'; code: string };

export interface CreateRoomResponse {
  roomCode: string;
  ownerToken: string;
  expiresAt: number;
  iceServers: RTCIceServer[];
}

export interface JoinRoomResponse {
  receiverToken: string;
  expiresAt: number;
  iceServers: RTCIceServer[];
}

export interface ReceivedFile {
  manifest: TransferManifest;
  blob: Blob;
  url: string;
}
