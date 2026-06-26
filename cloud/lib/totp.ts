// RFC 6238 TOTP (and RFC 4226 HOTP) implemented on Node crypto so we don't pull
// in a dependency. Standard 30s step, 6 digits, SHA-1 (what authenticator apps use).
import { createHmac, randomBytes } from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Random base32 secret (no padding) for a new enrollment.
export function generateSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // 53-bit safe: write the counter as a big-endian 64-bit value.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

// Verify a code against the current 30s window +/- 1 step (clock skew tolerance).
// nowMs is injected (Date.now() in the handler) so this stays pure + testable.
export function verifyTotp(secret: string, code: string, nowMs: number): boolean {
  const step = Math.floor(nowMs / 1000 / 30);
  const target = code.trim();
  for (let w = -1; w <= 1; w++) {
    if (hotp(secret, step + w) === target) return true;
  }
  return false;
}

// otpauth:// URI an authenticator app can render as a QR code.
export function otpauthUri(secret: string, account: string, issuer = 'FreeSwarm'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
