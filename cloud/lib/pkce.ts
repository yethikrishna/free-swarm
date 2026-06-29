// PKCE (RFC 7636) helpers for OAuth code exchange security.
import { randomBytes } from 'crypto';

// Generate a random 43-128 character code_verifier.
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

// Compute the S256 code_challenge from a verifier.
export function generateCodeChallenge(verifier: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
