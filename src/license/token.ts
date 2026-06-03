/**
 * GRST token parsing + verification (spec §2).
 *
 *   GRST.<payload_b64url>.<sig_b64url>
 *   sig = Ed25519_sign(privkey, "<payload_b64url>")   // signs the b64url string
 *
 * Verification tries every trusted public key (prod, plus dev in dev builds).
 */
import { verifyEd25519 } from './crypto';
import { trustedPubkeysHex } from './keys';
import { Entitlement, TokenPayload } from './types';

const PREFIX = 'GRST';

// ── base64url (no padding) ⇄ bytes ──────────────────────────────────────────

function bytesToB64url(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { bytesToB64url, b64urlToBytes };

// ── payload validation ──────────────────────────────────────────────────────

function isEntitlement(x: unknown): x is Entitlement {
  return typeof x === 'string' && (x === 'all' || x.startsWith('tab:'));
}

function isValidPayload(p: unknown): p is TokenPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.v === 'number' &&
    typeof o.oid === 'string' &&
    o.oid.length > 0 &&
    Array.isArray(o.ent) &&
    o.ent.length > 0 &&
    o.ent.every(isEntitlement) &&
    typeof o.iat === 'number'
  );
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'bad_format' | 'bad_signature' };

/**
 * Parse + cryptographically verify a token. Returns the decoded payload only
 * when the signature checks out against a trusted key.
 */
export function verifyToken(token: string): VerifyResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'bad_format' };

  const payloadB64 = parts[1];
  const sigB64 = parts[2];

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'bad_format' };
  }
  if (!isValidPayload(payload)) return { ok: false, reason: 'bad_format' };

  let sig: Uint8Array;
  try {
    sig = b64urlToBytes(sigB64);
  } catch {
    return { ok: false, reason: 'bad_format' };
  }

  const msg = new TextEncoder().encode(payloadB64);
  for (const pub of trustedPubkeysHex()) {
    if (pub && verifyEd25519(sig, msg, pub)) return { ok: true, payload };
  }
  return { ok: false, reason: 'bad_signature' };
}
