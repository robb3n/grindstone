import { CardData, Rating, CardState } from '../card/types';
import { schedule } from '../srs/sm2';
import { CardManager } from '../card/card-manager';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { formatDate, logicalNow } from '../util/date';
import { cardHasAutoShowTag } from '../util/tag-match';

export interface QueueItem {
  id: string;
  card: CardData;
}

export interface IntervalPreview {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

/**
 * Shared review session controller.
 * Used by both ReviewModal and inline workspace review.
 */
export class ReviewEngine {
  private queue: QueueItem[];
  private currentIndex = 0;
  private gsStore: GrindstoneStore;
  private cardManager: CardManager;

  constructor(
    queue: QueueItem[],
    gsStore: GrindstoneStore,
    cardManager: CardManager,
  ) {
    this.queue = queue;
    this.gsStore = gsStore;
    this.cardManager = cardManager;
  }

  getCurrentItem(): QueueItem | null {
    if (this.currentIndex >= this.queue.length) return null;
    return this.queue[this.currentIndex];
  }

  getPosition(): { current: number; total: number } {
    return { current: this.currentIndex + 1, total: this.queue.length };
  }

  getProgress(): number {
    if (this.queue.length === 0) return 1;
    return this.currentIndex / this.queue.length;
  }

  isComplete(): boolean {
    return this.currentIndex >= this.queue.length;
  }

  isAutoShow(): boolean {
    const item = this.getCurrentItem();
    if (!item) return false;
    return cardHasAutoShowTag(item.card.tags, this.gsStore.getSettings().autoShowTags);
  }

  previewIntervals(): IntervalPreview {
    const item = this.getCurrentItem();
    if (!item) return { again: '', hard: '', good: '', easy: '' };
    const { id, card } = item;
    const params = this.gsStore.getSrsParamsForCard(id, card);
    const state: CardState = { interval: card.interval, ease: card.ease, reviewCount: card.reviewCount };

    const preview = (rating: Rating): string => {
      const result = schedule(state, rating, params);
      return formatInterval(result.interval);
    };

    return {
      again: preview('again'),
      hard: preview('hard'),
      good: preview('good'),
      easy: preview('easy'),
    };
  }

  async rate(rating: Rating, elapsed: number): Promise<void> {
    const item = this.getCurrentItem();
    if (!item) return;
    const { id, card } = item;

    const params = this.gsStore.getSrsParamsForCard(id, card);
    const newState = schedule(
      { interval: card.interval, ease: card.ease, reviewCount: card.reviewCount },
      rating,
      params,
    );

    const dueAtReview = card.due;

    const today = logicalNow();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + newState.interval);

    card.interval = newState.interval;
    card.ease = newState.ease;
    card.reviewCount = newState.reviewCount;
    card.due = formatDate(dueDate);
    card.lastReviewed = formatDate(today);

    this.gsStore.setCard(id, card);
    await this.gsStore.save();
    await this.gsStore.addReviewLog({
      cardId: id,
      rating,
      timestamp: today.toISOString().slice(0, 19),
      elapsed,
      dueAtReview,
    });
    this.gsStore.notePrimaryDeckOnRate(id, card);
    await this.cardManager.writeStarsBack(card, id, rating);

    // Re-queue when Again produces interval 0
    if (newState.interval === 0) {
      this.queue.push({ id, card });
    }

    this.currentIndex++;
  }
}

export function formatInterval(days: number): string {
  if (days === 0) return '<1m';
  if (days === 1) return '+1d';
  if (days < 30) return `+${days}d`;
  if (days < 365) return `+${Math.round(days / 30)}mo`;
  return `+${(days / 365).toFixed(1)}y`;
}
