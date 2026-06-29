// Bearer token = HS256 JWT minted here after sign-in. The desktop receives it
// from the handoff page and re-validates via /api/auth/signin-activate; the web
// app stores it in localStorage['fs_web_token']. Tokens carry audience (aud: 'desktop'|'web'|'cloud')
// to prevent cross-surface replay. JTI (unique ID) enables revocation. Phase 0 foundation:
// adds aud/jti/ver claims; Phase 1 adds refresh tokens + explicit revocation table.
import { SignJWT, jwtVerify } from 'jose';
import type { VercelRequest } from '@vercel/node';
import { randomUUID } from 'crypto';

const secretStr = process.env.AUTH_SECRET || '';
const secret = new TextEncoder().encode(secretStr);
const TOKEN_VERSION = '1'; // Bumped when claim shape changes; grace window for old tokens without aud.

export function authReady(): boolean {
  // A real secret must be set; the empty-string fallback would sign nothing safe.
  return secretStr.length >= 16;
}

export interface TokenClaims {
  sub: string; // our user id
  email: string;
  aud?: string; // 'desktop' | 'web' | 'cloud'; missing treated as 'web' for one release (grace window)
  jti?: string; // unique token ID for revocation
  ver?: string; // token version; '1' for aud/jti support
  typ?: string; // 'access' | 'refresh'; defaults to 'access'
}

// Mint an access token (15 min, audience-scoped, revocable via jti).
export async function mintAccessToken(claims: TokenClaims, aud: 'desktop' | 'web' | 'cloud' = 'web'): Promise<string> {
  const jti = randomUUID();
  return new SignJWT({
    email: claims.email,
    aud,
    jti,
    ver: TOKEN_VERSION,
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

// Mint a refresh token (30 day, audience-scoped, stored hashed in DB for revocation).
export async function mintRefreshToken(claims: TokenClaims, aud: 'desktop' | 'web' | 'cloud' = 'web'): Promise<string> {
  const jti = randomUUID();
  return new SignJWT({
    email: claims.email,
    aud,
    jti,
    ver: TOKEN_VERSION,
    typ: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

// Legacy 30-day token (no aud/jti; used during migration). Deprecated; use mintAccessToken + mintRefreshToken.
export async function mintToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

// Verify a token and check its audience. Accepts legacy tokens without aud (grace window).
export async function verifyToken(token: string, expectedAud?: 'desktop' | 'web' | 'cloud'): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== 'string') return null;

    // Grace window: tokens without aud are treated as web-aud (one release only).
    const aud = String(payload.aud ?? 'web');
    if (expectedAud && aud !== expectedAud) {
      // Audience mismatch: surface rejection. Desktop rejects non-desktop tokens, web rejects non-web, etc.
      return null;
    }

    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      aud: aud as 'desktop' | 'web' | 'cloud',
      jti: payload.jti ? String(payload.jti) : undefined,
      ver: payload.ver ? String(payload.ver) : undefined,
      typ: payload.typ ? String(payload.typ) : 'access',
    };
  } catch {
    return null;
  }
}

// Convenience guard for the feature endpoints: verify the bearer and return the
// claims, or null when missing/invalid. Callers 401 on null. Accepts any aud
// (these are account-management calls reachable from web or desktop).
export async function requireUser(req: VercelRequest): Promise<TokenClaims | null> {
  const token = extractBearer(req);
  if (!token) return null;
  return verifyToken(token);
}

// Pull the bearer from the Authorization header (server-to-server, desktop) or
// the web token from localStorage/fs_web_token cookie (browser). Note: fs_session
// cookie is dead code (never set by backend); kept here for old clients only.
export function extractBearer(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  const cookie = req.headers.cookie;
  if (cookie) {
    // Prefer fs_web_token (the real web cookie); fall back to fs_session (dead code, one release).
    let m = cookie.match(/(?:^|;\s*)fs_web_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = cookie.match(/(?:^|;\s*)fs_session=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}
