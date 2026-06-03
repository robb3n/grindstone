/**
 * GrindstoneStore — facade between the workspace views and DataStore.
 *
 * Views never read data.json directly; they call this store. Each derived
 * query lives in src/store/queries/*.ts as a pure function over DataStore.
 * The class itself only holds mutable cache state (primary-deck cache) and
 * a few methods that need it.
 */

import { DataStore } from '../storage/data-store';
import {
  CardData, GrindstoneSettings, ReviewLog, SrsParams, DeckResetMode, ReviewOrder,
  CramSession,
} from '../card/types';
import { today } from '../util/date';

import * as Overview from './queries/overview';
import * as Decks from './queries/decks';
import * as Stats from './queries/stats';
import * as Review from './queries/review';
import * as Tags from './queries/tags';
import { resolvePresetParams, resolveStrategyName } from './queries/srs';
import { computeFreezeSweep } from './queries/streak-freeze';

import type {
  OverviewStats, ForecastDay, TodayProgress, MaturityData,
  RatingsData, TagSummary,
} from './queries/overview';
import type { DeckNode } from './queries/decks';
import type { StatsKPI, ForgettingPoint, AccuracyByTag } from './queries/stats';
import type { CardEntry, ReviewSession, ReviewDeck } from './queries/review';
import type { TagTreeNode } from './queries/tags';

// Re-export so view-layer `import { TagTreeNode } from '../store/GrindstoneStore'` keeps working.
export type {
  OverviewStats, ForecastDay, TodayProgress, MaturityData,
  RatingsData, TagSummary, DeckNode, StatsKPI, ForgettingPoint,
  AccuracyByTag, CardEntry, ReviewSession, ReviewDeck, TagTreeNode,
};

export class GrindstoneStore {
  private primaryDeckCache: Map<string, string> | null = null;
  /** Per-card top-level-tag review counts, kept in sync with primaryDeckCache. */
  private cardTagCounts: Map<string, Map<string, number>> | null = null;

  constructor(private dataStore: DataStore) {}

  // ── Overview ────────────────────────────────────────────

  getOverviewStats(): OverviewStats { return Overview.getOverviewStats(this.dataStore); }
  getForecast7D(): ForecastDay[] { return Overview.getForecast7D(this.dataStore); }
  getTodayProgress(): TodayProgress { return Overview.getTodayProgress(this.dataStore); }
  getMaturity(): MaturityData { return Overview.getMaturity(this.dataStore); }
  getRatingsDistribution(days?: number): RatingsData {
    return Overview.getRatingsDistribution(this.dataStore, days);
  }
  get12WeekHeatmap(): number[] { return Overview.get12WeekHeatmap(this.dataStore); }
  getTopTags(limit?: number): TagSummary[] { return Overview.getTopTags(this.dataStore, limit); }

  /** Returns the current freeze bank; 0 when strict mode is on. */
  getStreakFreezes(): number {
    const s = this.dataStore.getSettings();
    if (s.strictStreakMode === true) return 0;
    return s.streakFreezes ?? 0;
  }

  /**
   * Run the freeze-state sweep (idempotent). Called once at plugin load to
   * grant weekly freezes and auto-consume any pending gap days. No-op when
   * strict mode is on.
   */
  async ensureFreezeState(): Promise<void> {
    const patch = computeFreezeSweep(this.dataStore);
    if (!patch) return;
    await this.dataStore.updateSettings(patch);
  }

  // ── Decks ───────────────────────────────────────────────

  getDeckTree(): DeckNode[] { return Decks.getDeckTree(this.dataStore); }

  // ── Stats ───────────────────────────────────────────────

  getStatsKPI(days: number): StatsKPI { return Stats.getStatsKPI(this.dataStore, days); }
  getReviewTrend(days: number): Array<{ date: string; count: number }> {
    return Stats.getReviewTrend(this.dataStore, days);
  }
  getAccuracyByTag(): AccuracyByTag[] { return Stats.getAccuracyByTag(this.dataStore); }
  getForgettingCurve(): ForgettingPoint[] { return Stats.getForgettingCurve(this.dataStore); }
  getStudyMinutesTrend(days: number): Array<{ date: string; minutes: number }> {
    return Stats.getStudyMinutesTrend(this.dataStore, days);
  }

  // ── Review (launch pad) ─────────────────────────────────

  getDueCards(): CardEntry[] { return Review.getDueCards(this.dataStore); }
  getDueBreakdown(): MaturityData { return Review.getDueBreakdown(this.dataStore); }
  getDueCardsByTag(tag: string): CardEntry[] { return Review.getDueCardsByTag(this.dataStore, tag); }
  /** Root-tag decks over the due queue, for the Review launch scope picker. */
  getReviewDecks(): ReviewDeck[] { return Review.getReviewDecks(this.dataStore); }
  /** Sorted queue for review entry-points. Count sites keep using getDueCards (unsorted, cheap). */
  getReviewQueue(tag?: string): CardEntry[] {
    const entries = tag
      ? Review.getDueCardsByTag(this.dataStore, tag)
      : Review.getDueCards(this.dataStore);
    return sortReviewQueue(entries, this.getSettings().reviewOrder ?? 'random');
  }
  getRecentSessions(limit?: number): ReviewSession[] {
    return Review.getRecentSessions(this.dataStore, limit);
  }

  // ── Tags ────────────────────────────────────────────────

  getTagTree(): TagTreeNode[] { return Tags.getTagTree(this.dataStore); }
  getCardsByTag(tag: string | null, search?: string): CardEntry[] {
    return Tags.getCardsByTag(this.dataStore, tag, search);
  }
  getCardsByTags(tags: Set<string>, search?: string): CardEntry[] {
    return Tags.getCardsByTags(this.dataStore, tags, search);
  }
  getAccuracyForTag(tag: string): number | null {
    return Tags.getAccuracyForTag(this.dataStore, tag);
  }

  // ── SRS params (stateful — uses primaryDeckCache) ───────

  getSrsParams(): SrsParams {
    return this.dataStore.getSrsParams();
  }

  /** Resolve SRS params for a specific card based on its primary deck. */
  getSrsParamsForCard(cardId: string, card: CardData): SrsParams {
    const overrides = this.dataStore.getDeckSrsOverrides();
    if (Object.keys(overrides).length === 0) return this.getSrsParams();

    const primaryDeck = this.getPrimaryDeck(cardId, card);
    const override = overrides[primaryDeck];
    if (!override) return this.getSrsParams();

    if (typeof override === 'string') return resolvePresetParams(this.dataStore, override);
    return override;
  }

  /** Determine the primary deck (top-level tag) for a card based on review frequency. */
  getPrimaryDeck(cardId: string, card: CardData): string {
    if (card.reviewCount === 0) {
      return card.tags[0]?.split('/')[0] ?? '';
    }
    if (!this.primaryDeckCache) {
      this.primaryDeckCache = this.buildPrimaryDeckCache();
    }
    return this.primaryDeckCache.get(cardId) ?? card.tags[0]?.split('/')[0] ?? '';
  }

  invalidatePrimaryDeckCache(): void {
    this.primaryDeckCache = null;
    this.cardTagCounts = null;
  }

  /**
   * Incrementally fold a new review into the primary-deck cache. Cheaper than
   * a full rebuild after every rating. No-op if cache is cold (lazy build will
   * pick up the rating from the persisted log).
   */
  notePrimaryDeckOnRate(cardId: string, card: CardData): void {
    if (!this.primaryDeckCache || !this.cardTagCounts) return;
    let tagMap = this.cardTagCounts.get(cardId);
    if (!tagMap) {
      tagMap = new Map();
      this.cardTagCounts.set(cardId, tagMap);
    }
    for (const tag of card.tags) {
      const topTag = tag.split('/')[0];
      tagMap.set(topTag, (tagMap.get(topTag) ?? 0) + 1);
    }
    let maxTag = '';
    let maxCount = 0;
    for (const [tag, count] of tagMap) {
      if (count > maxCount) { maxCount = count; maxTag = tag; }
    }
    if (maxTag) this.primaryDeckCache.set(cardId, maxTag);
  }

  private buildPrimaryDeckCache(): Map<string, string> {
    const logs = this.dataStore.getReviewLogs();
    const cards = this.dataStore.getAllCards();

    const cardTagCounts = new Map<string, Map<string, number>>();
    for (const log of logs) {
      const card = cards[log.cardId];
      if (!card) continue;
      if (!cardTagCounts.has(log.cardId)) cardTagCounts.set(log.cardId, new Map());
      const tagMap = cardTagCounts.get(log.cardId)!;
      for (const tag of card.tags) {
        const topTag = tag.split('/')[0];
        tagMap.set(topTag, (tagMap.get(topTag) ?? 0) + 1);
      }
    }

    const result = new Map<string, string>();
    for (const [cardId, tagMap] of cardTagCounts) {
      let maxTag = '';
      let maxCount = 0;
      for (const [tag, count] of tagMap) {
        if (count > maxCount) { maxCount = count; maxTag = tag; }
      }
      if (maxTag) result.set(cardId, maxTag);
    }
    this.cardTagCounts = cardTagCounts;
    return result;
  }

  /** Display name for a deck's strategy override (pure helper, no cache). */
  resolveStrategyName(deckTag: string): string {
    return resolveStrategyName(this.dataStore, deckTag);
  }

  async setDeckStrategy(deckTag: string, value: string | SrsParams | null): Promise<void> {
    const overrides = { ...this.dataStore.getDeckSrsOverrides() };
    if (value === null) {
      delete overrides[deckTag];
    } else {
      overrides[deckTag] = value;
    }
    await this.dataStore.updateSettings({ deckSrsOverrides: overrides });
  }

  async resetDeckCards(deckTag: string, mode: DeckResetMode, newParams: SrsParams): Promise<void> {
    if (mode === 'gradual') return;

    const cards = this.dataStore.getAllCards();
    const t = today();
    const updates: Array<{ id: string; patch: Partial<CardData> }> = [];

    for (const [id, card] of Object.entries(cards)) {
      if (card.disabled) continue;
      const primary = this.getPrimaryDeck(id, card);
      if (primary !== deckTag) continue;

      if (mode === 'reset-ease') {
        updates.push({ id, patch: { ease: newParams.initialEase } });
      } else if (mode === 'full-reset') {
        updates.push({ id, patch: {
          ease: newParams.initialEase,
          interval: 0,
          due: t,
          reviewCount: 0,
        }});
      }
    }

    this.dataStore.bulkUpdateCards(updates);
    await this.dataStore.save();
    this.invalidatePrimaryDeckCache();
  }

  // ── Misc ────────────────────────────────────────────────

  getTotalActiveCards(): number {
    return this.dataStore.getStats(today()).active;
  }

  // ── Settings facade ─────────────────────────────────────

  getSettings(): GrindstoneSettings {
    return this.dataStore.getSettings();
  }

  updateSettings(patch: Partial<GrindstoneSettings>): Promise<void> {
    return this.dataStore.updateSettings(patch);
  }

  // ── Review-flow facade (used by ReviewEngine) ───────────

  setCard(id: string, card: CardData): void {
    this.dataStore.setCard(id, card);
  }

  /** Immediate write — review flow calls this, not the debounced variant. */
  save(): Promise<void> {
    return this.dataStore.save();
  }

  addReviewLog(log: ReviewLog): Promise<void> {
    return this.dataStore.addReviewLog(log);
  }

  // ── Raw analytics inputs (used by capability radar) ─────

  getAllCardsMap(): Record<string, CardData> {
    return this.dataStore.getAllCards();
  }

  getRawReviewLogs(): ReviewLog[] {
    return this.dataStore.getReviewLogs();
  }

  // ── Cram session passthrough ────────────────────────────

  getCramSessions(): CramSession[] {
    return this.dataStore.getCramSessions();
  }

  addCramSession(session: CramSession): Promise<void> {
    return this.dataStore.addCramSession(session);
  }
}

function sortReviewQueue(entries: CardEntry[], order: ReviewOrder): CardEntry[] {
  switch (order) {
    case 'due-date':
      return [...entries].sort((a, b) => a.card.due.localeCompare(b.card.due));
    case 'as-added':
      return entries;
    case 'random':
    default: {
      const arr = entries.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }
}
