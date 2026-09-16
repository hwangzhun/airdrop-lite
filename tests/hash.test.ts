import { describe, expect, it } from 'vitest';
import { deriveSafetyCode, sha256Blob, validateFile } from '../services/p2p/hash';

describe('P2P integrity helpers', () => {
  it('calculates a stable SHA-256 digest', async () => {
    expect(await sha256Blob(new Blob(['hello']))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('derives the same safety code when SDP candidates differ', async () => {
    const senderA = 'v=0\r\na=fingerprint:sha-256 AA:BB\r\na=candidate:one\r\n';
    const senderB = 'v=0\r\na=fingerprint:sha-256 AA:BB\r\na=candidate:two\r\n';
    const receiver = 'v=0\r\na=fingerprint:sha-256 CC:DD\r\n';
    expect(await deriveSafetyCode(senderA, receiver)).toBe(await deriveSafetyCode(senderB, receiver));
  });

  it('rejects files larger than 100 MB', () => {
    expect(() => validateFile({ size: 100 * 1024 * 1024 + 1 } as File)).toThrow(/100 MB/);
  });
});
