const MAX_FILE_SIZE = 100 * 1024 * 1024;

export function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) throw new Error('单个文件不能超过 100 MB');
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function deriveSafetyCode(senderSdp: string, receiverSdp: string): Promise<string> {
  const fingerprints = (sdp: string) => Array.from(new Set(
    sdp.split(/\r?\n/).filter(line => line.startsWith('a=fingerprint:')),
  )).sort().join('|');
  const data = new TextEncoder().encode(`${fingerprints(senderSdp)}\n---airdrop-lite---\n${fingerprints(receiverSdp)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const value = ((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1_000_000;
  return value.toString().padStart(6, '0');
}

export const MAX_FILE_BYTES = MAX_FILE_SIZE;
