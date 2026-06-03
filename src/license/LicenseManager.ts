/**
 * LicenseManager — the single home of the paywall (spec §3, §5).
 *
 * Exposes computed capability queries only; there is no cached `isPro` boolean
 * anywhere. `canUseTab` is THE gate router — every Pro entry point calls it and
 * it re-verifies signatures each time, so flipping a local flag does nothing.
 *
 * Offline-first: entitlements self-prove from the signed token forever. The
 * network is used only for activation (device cap) and revocation refresh, both
 * covered by a 30-day grace so a flaky connection never locks a paying user out.
 */
import { App, requestUrl } from 'obsidian';
import { DataStore } from '../storage/data-store';
import { verifyToken } from './token';
import { LICENSE_API_BASE } from './keys';
import {
  AddOutcome, Entitlement, KeyInfo, LicenseData, StoredKey,
} from './types';

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (spec §0/§13)

export interface RemoteActivation {
  vault_id: string;
  activated_at: string;
}

export class LicenseManager {
  private app: App;
  private store: DataStore;
  private apiBase = LICENSE_API_BASE;

  constructor(app: App, store: DataStore) {
    this.app = app;
    this.store = store;
  }

  // ── vault id ───────────────────────────────────────────────────────────────

  /**
   * Stable, machine-independent id for this vault. Generated once and persisted
   * in data.json — so Obsidian Sync / iCloud carry it across devices and the
   * backend counts the synced vault as a single seat (spec §4).
   */
  vaultId(): string {
    const lic = this.store.getLicense();
    if (lic?.vault_id) return lic.vault_id;
    const id = genVaultId();
    void this.store.setLicense({ keys: [], ...(lic ?? {}), vault_id: id });
    return id;
  }

  // ── capability queries (recomputed every call, no cache) ─────────────────────

  /** Verify every stored token and union the entitlements that still hold. */
  entitlements(): Set<Entitlement> {
    // Dev-build full unlock — stripped from production (spec §8, CLAUDE.md).
    if (__GS_DEV__) return new Set<Entitlement>(['all']);

    const lic = this.store.getLicense();
    const result = new Set<Entitlement>();
    if (!lic || lic.keys.length === 0) return result;

    // Offline teeth: if we have a contact baseline and haven't reached the
    // server in 30 days, degrade to free until we reconnect.
    if (this.offlineGraceExpired(lic)) return result;

    const revoked = new Set(lic.revoked_oids ?? []);
    const revokedAt = lic.revoked_at ?? {};
    const now = Date.now();

    for (const k of lic.keys) {
      const v = verifyToken(k.token);
      if (!v.ok) continue;
      const oid = v.payload.oid;
      if (revoked.has(oid)) {
        // Revoked → keep working through a grace window, then drop. A malformed
        // revoked_at (hand-edited / corrupt data.json) must NOT make a revoked
        // key immortal — fall back to "now" so the grace still elapses.
        const parsed = revokedAt[oid] ? Date.parse(revokedAt[oid]) : now;
        const since = Number.isNaN(parsed) ? now : parsed;
        if (now - since > GRACE_PERIOD_MS) continue;
      }
      for (const e of v.payload.ent) result.add(e);
    }
    return result;
  }

  /** THE gate router. Locked Pro entry points call this and render a Teaser on false. */
  canUseTab(id: string): boolean {
    const ent = this.entitlements();
    return ent.has('all') || ent.has(`tab:${id}` as Entitlement);
  }

  /** True when any paid entitlement is active (used only for Settings summary copy). */
  hasAnyPro(): boolean {
    return this.entitlements().size > 0;
  }

  // ── stored-key management ────────────────────────────────────────────────────

  listKeys(): StoredKey[] {
    return this.store.getLicense()?.keys ?? [];
  }

  /** Rich per-key view for Settings (decoded oid/ent + active/revoked/invalid). */
  keyInfos(): KeyInfo[] {
    const lic = this.store.getLicense();
    if (!lic) return [];
    const revoked = new Set(lic.revoked_oids ?? []);
    return lic.keys.map((k) => {
      const v = verifyToken(k.token);
      if (!v.ok) {
        return { token: k.token, oid: '?', ent: [], activated_at: k.activated_at, status: 'invalid' as const };
      }
      return {
        token: k.token,
        oid: v.payload.oid,
        ent: v.payload.ent,
        activated_at: k.activated_at,
        status: revoked.has(v.payload.oid) ? ('revoked' as const) : ('active' as const),
      };
    });
  }

  /**
   * Add a key: verify signature → register with the backend (device cap) →
   * persist. Verification is local and authoritative; the network call only
   * enforces the seat limit and surfaces revocation.
   */
  async addKey(token: string): Promise<AddOutcome> {
    token = token.trim();
    const v = verifyToken(token);
    if (!v.ok) return { ok: false, reason: v.reason };

    const lic = this.currentOrEmpty();
    if (lic.keys.some((k) => k.token === token)) return { ok: false, reason: 'duplicate' };

    const vaultId = this.vaultId();
    const act = await this.postActivate(token, vaultId);
    // Hard stops only: cap reached or revoked. A network failure is NOT a hard
    // stop — the entitlement self-proves from its signature, so we store the key
    // and let `revalidate` register the seat later (offline grace, spec §0/§3).
    if (act === 'over_limit') return { ok: false, reason: 'over_limit' };
    if (act === 'revoked') return { ok: false, reason: 'revoked' };

    const stored: StoredKey = { token, activated_at: new Date().toISOString() };
    const next: LicenseData = { ...lic, vault_id: vaultId, keys: [...lic.keys, stored] };
    if (act === 'ok') next.last_revalidate_at = new Date().toISOString();
    await this.store.setLicense(next);
    return { ok: true, entitlements: [...v.payload.ent] };
  }

  /** Remove a key locally and best-effort free this vault's seat on the backend. */
  removeKey(token: string): void {
    const lic = this.store.getLicense();
    if (!lic) return;
    void this.postDeactivate(token, lic.vault_id).catch(() => {});
    void this.store.setLicense({ ...lic, keys: lic.keys.filter((k) => k.token !== token) });
  }

  // ── networking (activation + revocation; all best-effort) ────────────────────

  /**
   * Refresh revocation state for every stored key. Failures are swallowed — the
   * grace logic in entitlements() decides when a stale state finally bites.
   */
  async revalidate(): Promise<void> {
    if (__GS_DEV__) return;
    const lic = this.store.getLicense();
    if (!lic || lic.keys.length === 0) return;

    const vaultId = this.vaultId();
    const revoked = new Set(lic.revoked_oids ?? []);
    const revokedAt = { ...(lic.revoked_at ?? {}) };
    let anySuccess = false;

    for (const k of lic.keys) {
      const v = verifyToken(k.token);
      if (!v.ok) continue;
      const oid = v.payload.oid;
      const res = await this.postJson('/validate', { oid, vault_id: vaultId });
      if (!res) continue;
      anySuccess = true;
      const body = res as { revoked?: boolean };
      if (body.revoked) {
        revoked.add(oid);
        if (!revokedAt[oid]) revokedAt[oid] = new Date().toISOString();
      } else {
        revoked.delete(oid);
        delete revokedAt[oid];
      }
    }

    const next: LicenseData = { ...lic, revoked_oids: [...revoked], revoked_at: revokedAt };
    if (anySuccess) next.last_revalidate_at = new Date().toISOString();
    await this.store.setLicense(next);
  }

  /** List the vaults a token is currently activated on (self-service unbind UI). */
  async listActivations(token: string): Promise<RemoteActivation[]> {
    const res = await this.postJson('/activations', { token });
    const arr = (res as { activations?: RemoteActivation[] } | null)?.activations;
    return Array.isArray(arr) ? arr : [];
  }

  /** Unbind a specific vault from a token's seat list (frees a seat). */
  async unbindVault(token: string, vaultId: string): Promise<boolean> {
    return (await this.postDeactivate(token, vaultId)) === 'ok';
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private currentOrEmpty(): LicenseData {
    return this.store.getLicense() ?? { keys: [], vault_id: this.vaultId() };
  }

  private offlineGraceExpired(lic: LicenseData): boolean {
    // Baseline = last successful server contact, else the earliest activation.
    // The latter starts the offline clock even for a key added while offline, so
    // a never-online client still degrades after the grace window (spec §13).
    const baseline = lic.last_revalidate_at ?? earliestActivatedAt(lic.keys);
    if (!baseline) return false;
    const t = Date.parse(baseline);
    if (Number.isNaN(t)) return false;
    return Date.now() - t > GRACE_PERIOD_MS;
  }

  private async postActivate(
    token: string,
    vaultId: string,
  ): Promise<'ok' | 'over_limit' | 'revoked' | 'network'> {
    try {
      const res = await requestUrl({
        url: `${this.apiBase}/activate`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({ token, vault_id: vaultId }),
        throw: false,
      });
      if (res.status === 200) return 'ok';
      const err = (res.json as { error?: string } | undefined)?.error;
      if (res.status === 409 || err === 'over_limit') return 'over_limit';
      if (res.status === 403 || err === 'revoked') return 'revoked';
      return 'network';
    } catch {
      return 'network';
    }
  }

  private async postDeactivate(token: string, vaultId: string): Promise<'ok' | 'network'> {
    const res = await this.postJson('/deactivate', { token, vault_id: vaultId });
    return res ? 'ok' : 'network';
  }

  /** POST JSON, returning the parsed body on 2xx or null on any failure. */
  private async postJson(path: string, body: unknown): Promise<unknown | null> {
    try {
      const res = await requestUrl({
        url: `${this.apiBase}${path}`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify(body),
        throw: false,
      });
      if (res.status !== 200) return null;
      return res.json ?? {};
    } catch {
      return null;
    }
  }
}

function earliestActivatedAt(keys: StoredKey[]): string | undefined {
  let min: string | undefined;
  for (const k of keys) {
    if (k.activated_at && (min === undefined || k.activated_at < min)) min = k.activated_at;
  }
  return min;
}

function genVaultId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return 'v-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}
