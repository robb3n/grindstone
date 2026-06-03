/**
 * Embedded trust anchors + backend endpoint.
 *
 * The PRODUCTION public key is always compiled in. The DEV public key is only
 * added inside the `if (__GS_DEV__)` branch, which esbuild strips from the
 * production bundle (minifySyntax DCE) — verified by scripts/release-gate.mjs.
 *
 * Private keys NEVER live here: the prod private key is a `wrangler secret` on
 * the backend; the dev private key is local-only in .keys/ (gitignored). Public
 * keys are produced by scripts/gen-keys.mjs.
 */

// Ed25519 public key (hex, 32 bytes) — trust anchor for backend-issued tokens.
export const PROD_PUBKEY_HEX =
  'a6767bba34a0ad2c76c3edca31a6fce45bfd0b38ac89d9f8718f284db1509940';

// License server base URL — self-hosted Node service on the 腾讯云 VPS, behind
// nginx + TLS (see the license-server repo README). Used for /activate,
// /validate, /deactivate, /activations.
export const LICENSE_API_BASE = 'https://license.robb3n.site';

// afdian product page — the Teaser + Settings "buy" CTA opens this.
export const BUY_URL = 'https://www.ifdian.net/item/891a1b7a5e6b11f18a6752540025c377';

// Device (vault) cap per license — display only. The backend `/activate`
// endpoint is the authority (its DEVICE_LIMIT must match this). Spec §4 knob = 3.
export const DEVICE_LIMIT = 3;

/**
 * Every public key this build trusts. Production trusts only PROD_PUBKEY; dev
 * builds additionally trust the DEV key, so a dev-signed `all` token verifies
 * locally (and is worthless in production — no dev key compiled in). The branch
 * below is removed entirely from the production bundle.
 */
export function trustedPubkeysHex(): string[] {
  const keys = [PROD_PUBKEY_HEX];
  if (__GS_DEV__) {
    // DEV-ONLY trust anchor — stripped from the production bundle by DCE.
    keys.push('e425bd3fc9764947c5b2755f9603916d4963787367861dd47feb0507232c3721');
  }
  return keys;
}
