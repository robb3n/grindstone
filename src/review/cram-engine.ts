import { CardData, Rating, CramStats, CramSession, DeckFilter } from '../card/types';
import { GrindstoneStore } from '../store/GrindstoneStore';

export interface CramItem {
  id: string;
  card: CardData;
}

/**
 * Active-review (cram) session controller.
 *
 * Strictly data-isolated from SRS: never touches card.ease/interval/due/
 * reviewCount, never writes reviewLogs, never calls schedule(). Only writes
 * card.cram (per-card stats) and PluginData.cramSessions (session log).
 *
 * Rating semantics are within-session queue control, not SRS scheduling:
 *  - Again       → push card to queue tail; user must see it again this session
 *  - Hard        → push card a few slots ahead in queue (still this session)
 *  - Good / Easy → card out for this session
 */
export class CramEngine {
  private queue: CramItem[];
  private currentIndex = 0;
  private store: GrindstoneStore;
  private deckId: string | undefined;
  private filter: DeckFilter;
  private startedAt: number;
  private uniqueIds = new Set<string>();
  private totalRates = 0;
  private correctRates = 0;
  private againRates = 0;
  private initialUniqueCount = 0;
  private finished = false;
  private finishedSession: CramSession | null = null;

  /** Hard-rated cards get pushed back this many positions (or to tail if fewer remain). */
  private static readonly HARD_PUSH_BACK = 3;

  constructor(
    queue: CramItem[],
    store: GrindstoneStore,
    filter: DeckFilter,
    deckId?: string,
  ) {
    this.queue = [...queue]; // defensive copy — we mutate in rate()
    this.store = store;
    this.filter = filter;
    this.deckId = deckId;
    this.startedAt = Date.now();
    const seen = new Set<string>();
    for (const item of queue) seen.add(item.id);
    this.initialUniqueCount = seen.size;
  }

  getCurrentItem(): CramItem | null {
    if (this.currentIndex >= this.queue.length) return null;
    return this.queue[this.currentIndex];
  }

  /**
   * "Card N of M" — N = unique cards rated so far + 1 (for the one on screen).
   * M = original unique queue size.
   */
  getPosition(): { current: number; total: number } {
    if (this.isComplete()) return { current: this.initialUniqueCount, total: this.initialUniqueCount };
    const current = this.uniqueIds.size + (this.uniqueIds.has(this.queue[this.currentIndex].id) ? 0 : 1);
    return { current, total: this.initialUniqueCount };
  }

  /** Progress 0..1 by unique cards rated. */
  getProgress(): number {
    if (this.initialUniqueCount === 0) return 1;
    return this.uniqueIds.size / this.initialUniqueCount;
  }

  isComplete(): boolean {
    return this.currentIndex >= this.queue.length;
  }

  /** Total rates including Again-repeats. */
  getRatesSoFar(): number {
    return this.totalRates;
  }

  getAgainCount(): number {
    return this.againRates;
  }

  /**
   * Record a rating. Writes card.cram immediately (per-rate save) so closing
   * the modal mid-session doesn't lose per-card progress. Session log is
   * flushed via finish().
   */
  async rate(rating: Rating): Promise<void> {
    const item = this.getCurrentItem();
    if (!item) return;
    const { id, card } = item;

    this.uniqueIds.add(id);
    this.totalRates++;
    if (rating === 'good' || rating === 'easy') this.correctRates++;
    else if (rating === 'again') this.againRates++;

    // Update per-card cram stats.
    const existing: CramStats = card.cram ?? { count: 0, lastAt: 0, againCount: 0, correctCount: 0 };
    card.cram = {
      count: existing.count + 1,
      lastAt: Date.now(),
      againCount: existing.againCount + (rating === 'again' ? 1 : 0),
      correctCount: existing.correctCount + (rating === 'good' || rating === 'easy' ? 1 : 0),
    };
    this.store.setCard(id, card);
    await this.store.save();

    // Queue control — strictly within-session.
    if (rating === 'again') {
      this.queue.push({ id, card });
      this.currentIndex++;
    } else if (rating === 'hard') {
      const insertIdx = Math.min(
        this.currentIndex + 1 + CramEngine.HARD_PUSH_BACK,
        this.queue.length,
      );
      this.queue.splice(insertIdx, 0, { id, card });
      this.currentIndex++;
    } else {
      this.currentIndex++;
    }
  }

  /**
   * Finish the session — write the CramSession log entry. Idempotent: callers
   * may invoke this on natural completion AND on early close; we de-dupe by
   * checking the `finished` flag. Empty sessions (no rates) are skipped.
   * Returns the session summary, or null when nothing was recorded.
   */
  async finish(): Promise<CramSession | null> {
    if (this.finished) return this.finishedSession;
    this.finished = true;
    if (this.totalRates === 0) return null;
    const endedAt = Date.now();
    const session: CramSession = {
      id: `cram-${this.startedAt}`,
      startedAt: this.startedAt,
      endedAt,
      deckId: this.deckId,
      filter: this.filter,
      totalCards: this.totalRates,
      uniqueCards: this.uniqueIds.size,
      correctCount: this.correctRates,
      againCount: this.againRates,
      durationMs: endedAt - this.startedAt,
    };
    await this.store.addCramSession(session);
    this.finishedSession = session;
    return session;
  }
}
