// Bearer token = HS256 JWT minted here after sign-in. The desktop receives it
// from the handoff page and re-validates via /api/auth/signin-activate; the web
// app stores it in a cookie. Same token is the Authorization bearer everywhere.
import { SignJWT, jwtVerify } from 'jose';
import type { VercelRequest } from '@vercel/node';

const secretStr = process.env.AUTH_SECRET || '';
const secret = new TextEncoder().encode(secretStr);

export function authReady(): boolean {
  // A real secret must be set; the empty-string fallback would sign nothing safe.
  return secretStr.length >= 16;
}

export interface TokenClaims {
  sub: string; // our user id
  email: string;
}

export async function mintToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}

// Pull the bearer from the Authorization header (server-to-server, desktop) or
// the session cookie (browser, web app).
export function extractBearer(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = cookie.match(/(?:^|;\s*)fs_session=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}
