import { Plugin } from 'obsidian';
import {
  PluginData, CardData, DEFAULT_DATA, GrindstoneSettings, DEFAULT_SETTINGS,
  StoreStats, MaturityDistribution, ReviewLog, Rating, CramSession,
  SrsParams, DEFAULT_SRS_PARAMS, BUILTIN_INTENT_RECIPES, maturityBucket,
} from '../card/types';
import { intentToParams } from '../srs/intent';
import { formatDate } from '../util/date';
import type { LicenseData } from '../license/types';


export class DataStore {
  private data: PluginData;
  private plugin: Plugin;
  private saveTimer: number | null = null;
  private savePending: Promise<void> | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data = { ...DEFAULT_DATA, cards: {} };
  }

  async load(): Promise<void> {
    const raw = await this.plugin.loadData();
    if (raw) {
      this.data = {
        version: raw.version ?? 1,
        settings: { ...DEFAULT_SETTINGS, ...raw.settings },
        cards: raw.cards ?? {},
        reviewLogs: raw.reviewLogs ?? [],
        cramSessions: raw.cramSessions ?? [],
        // Optional — absent on free installs / pre-paywall data.json.
        license: raw.license,
      };
      // One-time fix: Anki Standard preset had step1/step2 swapped
      if (!this.data.settings._ankiStepFix) {
        const params = this.data.settings.srsParams;
        if (params && params.step1Interval > params.step2Interval) {
          const tmp = params.step1Interval;
          params.step1Interval = params.step2Interval;
          params.step2Interval = tmp;
        }
        this.data.settings._ankiStepFix = true;
      }
    }
  }

  async save(): Promise<void> {
    // Strip runtime-only fields before persisting
    const cleanCards: Record<string, CardData> = {};
    for (const [id, card] of Object.entries(this.data.cards)) {
      const { blockStartLine, ...rest } = card;
      cleanCards[id] = rest as CardData;
    }
    await this.plugin.saveData({ ...this.data, cards: cleanCards });
  }

  /**
   * Debounced save: coalesces high-frequency writers (vault scan events fire
   * for every file changed in a session). 300ms delay; flushed on plugin
   * unload via `flushSave()`.
   */
  saveDebounced(delayMs = 300): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.savePending = this.save().finally(() => { this.savePending = null; });
    }, delayMs);
  }

  /** Force-flush any pending debounced save. Awaits the in-flight write too. */
  async flushSave(): Promise<void> {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.save();
      return;
    }
    if (this.savePending) await this.savePending;
  }

  needsMigration(): boolean {
    return this.data.version < 2;
  }

  setVersion(v: number): void {
    this.data.version = v;
  }

  getSettings(): GrindstoneSettings {
    return this.data.settings;
  }

  // ── License (Pro entitlements) ──

  getLicense(): LicenseData | undefined {
    return this.data.license;
  }

  /** Persist the license blob immediately (small, low-frequency writes). */
  async setLicense(license: LicenseData): Promise<void> {
    this.data.license = license;
    await this.save();
  }

  getSrsParams(): SrsParams {
    const s = this.data.settings;
    if (s.defaultRecipeId) {
      const recipes = [...BUILTIN_INTENT_RECIPES, ...(s.userIntentRecipes ?? [])];
      const r = recipes.find(r => r.id === s.defaultRecipeId);
      if (r) return intentToParams(r.intent);
    }
    if (s.activeIntent) return intentToParams(s.activeIntent);
    return s.srsParams ?? DEFAULT_SRS_PARAMS;
  }

  getDeckSrsOverrides(): Record<string, string | SrsParams> {
    return this.data.settings.deckSrsOverrides ?? {};
  }

  bulkUpdateCards(updates: Array<{ id: string; patch: Partial<CardData> }>): void {
    for (const { id, patch } of updates) {
      const card = this.data.cards[id];
      if (card) Object.assign(card, patch);
    }
  }

  async updateSettings(s: Partial<GrindstoneSettings>): Promise<void> {
    this.data.settings = { ...this.data.settings, ...s };
    await this.save();
  }

  /**
   * Clear all learning data — cards, review logs, and derived streak/freeze
   * state. Settings (language, SRS params, slogan, deck overrides, etc.) are
   * preserved.
   */
  async resetLearningData(): Promise<void> {
    this.data.cards = {};
    this.data.reviewLogs = [];
    this.data.cramSessions = [];
    this.data.settings.streakFreezes = undefined;
    this.data.settings.freezeUsedDates = undefined;
    this.data.settings.lastFreezeGrantDate = undefined;
    await this.flushSave();
  }

  // ── Cram session methods ──

  getCramSessions(): CramSession[] {
    return this.data.cramSessions;
  }

  async addCramSession(session: CramSession): Promise<void> {
    this.data.cramSessions.push(session);
    await this.save();
  }

  getCard(id: string): CardData | undefined {
    return this.data.cards[id];
  }

  getAllCards(): Record<string, CardData> {
    return this.data.cards;
  }

  setCard(id: string, card: CardData): void {
    this.data.cards[id] = card;
  }

  deleteCard(id: string): void {
    delete this.data.cards[id];
  }

  /**
   * Delete all disabled cards (their source block no longer exists in any
   * vault file) and any review logs referencing them. Caller must run a
   * fullScan beforehand so `disabled` flags are current, and flush the
   * save afterwards.
   */
  removeOrphanCards(): { cards: number; logs: number } {
    const orphanIds = new Set<string>();
    for (const [id, card] of Object.entries(this.data.cards)) {
      if (card.disabled) orphanIds.add(id);
    }
    if (orphanIds.size === 0) return { cards: 0, logs: 0 };

    for (const id of orphanIds) delete this.data.cards[id];

    const beforeLogs = this.data.reviewLogs.length;
    this.data.reviewLogs = this.data.reviewLogs.filter(
      (log) => !orphanIds.has(log.cardId),
    );
    return { cards: orphanIds.size, logs: beforeLogs - this.data.reviewLogs.length };
  }

  /** Get cards due today or earlier (and not disabled, not archived). */
  getDueCards(today: string): Array<{ id: string; card: CardData }> {
    const result: Array<{ id: string; card: CardData }> = [];
    for (const [id, card] of Object.entries(this.data.cards)) {
      if (card.disabled) continue;
      if (card.archived) continue;
      if (card.due <= today) {
        result.push({ id, card });
      }
    }
    return result;
  }

  /** Get active cards grouped by tag. Each card may appear under multiple tags. */
  getCardsByTag(tag: string): Array<{ id: string; card: CardData }> {
    const result: Array<{ id: string; card: CardData }> = [];
    for (const [id, card] of Object.entries(this.data.cards)) {
      if (card.disabled) continue;
      if (card.tags.some((t) => t === tag || t.startsWith(tag + '/'))) {
        result.push({ id, card });
      }
    }
    return result;
  }

  /** Get cards due within a date range [startDate, endDate] (inclusive, YYYY-MM-DD). */
  getDueCardsByRange(
    startDate: string,
    endDate: string,
  ): Array<{ id: string; card: CardData }> {
    const result: Array<{ id: string; card: CardData }> = [];
    for (const [id, card] of Object.entries(this.data.cards)) {
      if (card.disabled) continue;
      if (card.archived) continue;
      if (card.due >= startDate && card.due <= endDate) {
        result.push({ id, card });
      }
    }
    return result;
  }

  /** Aggregate statistics snapshot. */
  getStats(today: string): StoreStats {
    let total = 0;
    let active = 0;
    let disabled = 0;
    let dueToday = 0;
    let reviewedToday = 0;

    for (const card of Object.values(this.data.cards)) {
      total++;
      if (card.disabled) {
        disabled++;
        continue;
      }
      active++;
      if (!card.archived && card.due <= today) dueToday++;
      if (card.lastReviewed === today) reviewedToday++;
    }

    return { total, active, disabled, dueToday, reviewedToday };
  }

  /** Card maturity distribution (active cards only). */
  getMaturityDistribution(): MaturityDistribution {
    const dist: MaturityDistribution = { new: 0, learning: 0, mature: 0 };
    for (const card of Object.values(this.data.cards)) {
      if (card.disabled) continue;
      dist[maturityBucket(card)]++;
    }
    return dist;
  }

  /** Due-cards-only maturity split. Sum equals dueToday from getStats. */
  getDueBreakdown(today: string): MaturityDistribution {
    const dist: MaturityDistribution = { new: 0, learning: 0, mature: 0 };
    for (const card of Object.values(this.data.cards)) {
      if (card.disabled) continue;
      if (card.archived) continue;
      if (card.due > today) continue;
      dist[maturityBucket(card)]++;
    }
    return dist;
  }

  // ── Review log methods ──

  /** Append a review log entry and persist. */
  async addReviewLog(log: ReviewLog): Promise<void> {
    this.data.reviewLogs.push(log);
    await this.save();
  }

  /** Number of review events per day over the last N days (one per rating, not per unique card). */
  getReviewHistory(days: number): Array<{ date: string; count: number }> {
    const result: Array<{ date: string; count: number }> = [];
    const today = new Date();
    const dateCountMap = new Map<string, number>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = formatDate(d);
      dateCountMap.set(ds, 0);
    }

    for (const log of this.data.reviewLogs) {
      const logDate = log.timestamp.slice(0, 10); // "YYYY-MM-DD"
      if (dateCountMap.has(logDate)) {
        dateCountMap.set(logDate, (dateCountMap.get(logDate) ?? 0) + 1);
      }
    }

    for (const [date, count] of dateCountMap) {
      result.push({ date, count });
    }
    return result;
  }

  /** Rating distribution. If days is provided, only count logs within that window. */
  getRatingDistribution(days?: number): Record<Rating, number> {
    const dist: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
    const cutoff = days != null ? this.dateCutoff(days) : null;

    for (const log of this.data.reviewLogs) {
      if (cutoff && log.timestamp < cutoff) continue;
      dist[log.rating]++;
    }
    return dist;
  }

  /** Total study time (ms) per day over the last N days. */
  getDailyStudyTime(days: number): Array<{ date: string; ms: number }> {
    const result: Array<{ date: string; ms: number }> = [];
    const today = new Date();
    const dateMap = new Map<string, number>();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dateMap.set(formatDate(d), 0);
    }

    for (const log of this.data.reviewLogs) {
      const logDate = log.timestamp.slice(0, 10);
      if (dateMap.has(logDate)) {
        dateMap.set(logDate, (dateMap.get(logDate) ?? 0) + log.elapsed);
      }
    }

    for (const [date, ms] of dateMap) {
      result.push({ date, ms });
    }
    return result;
  }

  private dateCutoff(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return formatDate(d) + 'T00:00:00';
  }

  /** Raw review log entries. */
  getReviewLogs(): ReviewLog[] {
    return this.data.reviewLogs;
  }

  /** Number of cards due on each of the next N days. */
  getUpcomingDue(days: number): Array<{ date: string; count: number }> {
    const today = new Date();
    const result: Array<{ date: string; count: number }> = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);
      let count = 0;
      for (const card of Object.values(this.data.cards)) {
        if (card.disabled) continue;
        if (card.due === dateStr) count++;
      }
      result.push({ date: dateStr, count });
    }

    // Also count overdue cards (due before today) and add to day 0
    if (result.length > 0) {
      const todayStr = result[0].date;
      for (const card of Object.values(this.data.cards)) {
        if (card.disabled) continue;
        if (card.due < todayStr) result[0].count++;
      }
    }

    return result;
  }
}
