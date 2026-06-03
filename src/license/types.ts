/**
 * License layer shared types. The whole paywall collapses onto these — no
 * cached `isPro` boolean lives anywhere (spec §5).
 */

/** Entitlement string: a specific Pro tab, or `all` (everything incl. future tabs). */
export type Entitlement = `tab:${string}` | 'all';

/** The decoded payload of a GRST token (spec §2). */
export interface TokenPayload {
  /** schema version */
  v: number;
  /** afdian out_trade_no — the anchor for revocation + device binding */
  oid: string;
  /** granted entitlements */
  ent: Entitlement[];
  /** issued-at, unix seconds */
  iat: number;
}

/** A token the user pasted, plus when this vault activated it. */
export interface StoredKey {
  token: string;
  /** ISO8601 */
  activated_at: string;
}

/** The `license` blob persisted inside data.json (spec §3). */
export interface LicenseData {
  keys: StoredKey[];
  /** stable, machine-independent vault id (travels with data.json on Sync) */
  vault_id: string;
  /** ISO8601 of the last *successful* server contact (drives the offline grace) */
  last_revalidate_at?: string;
  /** locally-cached revoked order ids */
  revoked_oids?: string[];
  /** oid → ISO8601 first-seen-revoked (drives the revocation grace countdown) */
  revoked_at?: Record<string, string>;
}

export type AddFailReason =
  | 'bad_format'     // not a GRST token / unparseable
  | 'bad_signature'  // signature did not verify against any trusted key
  | 'revoked'        // backend reports this order revoked
  | 'over_limit'     // device (vault) cap reached
  | 'network'        // could not reach the activation endpoint
  | 'duplicate';     // this exact token is already stored

export type AddOutcome =
  | { ok: true; entitlements: Entitlement[] }
  | { ok: false; reason: AddFailReason };

/** Per-key view for the Settings UI. */
export interface KeyInfo {
  token: string;
  oid: string;
  ent: Entitlement[];
  activated_at: string;
  /** verification / revocation state for display */
  status: 'active' | 'revoked' | 'invalid';
}
