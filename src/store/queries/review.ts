import { DataStore } from '../../storage/data-store';
import { CardData, Rating, maturityBucket } from '../../card/types';
import { today } from '../../util/date';
import { MaturityData } from './overview';

export interface CardEntry {
  id: string;
  card: CardData;
}

export interface ReviewSession {
  date: string;
  cards: number;
  minutes: number;
  ratings: Record<Rating, number> | null;
  /** Top tags that appeared in this session's reviewed cards. */
  scope: string[];
}

export function getDueCards(ds: DataStore): CardEntry[] {
  return ds.getDueCards(today());
}

export function getDueBreakdown(ds: DataStore): MaturityData {
  const dist = ds.getDueBreakdown(today());
  return { new: dist.new, learning: dist.learning, mature: dist.mature };
}

export function getDueCardsByTag(ds: DataStore, tag: string): CardEntry[] {
  const t = today();
  // Mirror getDueCards: archived cards never enter a review queue.
  return ds.getCardsByTag(tag).filter((e) => !e.card.archived && e.card.due <= t);
}

/** A root-tag deck for the Review launch scope picker. */
export interface ReviewDeck {
  /** Root tag, e.g. "#grind" (matches itself or any "#grind/..." child). */
  tag: string;
  /** Display name — the root tag as stored. */
  name: string;
  /** Due-today card count under this root tag. */
  due: number;
  /** Due-card maturity split (sums to `due`). */
  breakdown: MaturityData;
}

/**
 * Root-tag decks over the due queue, for the Review tab scope picker. One pass
 * over the due cards; a card carrying several root tags counts toward each.
 * Counts mirror getReviewQueue(tag) exactly, so the picked queue length always
 * matches the pill — both flow from the same archived/disabled-filtered source.
 */
export function getReviewDecks(ds: DataStore): ReviewDeck[] {
  const map = new Map<string, MaturityData>();
  for (const { card } of ds.getDueCards(today())) {
    const bucket = maturityBucket(card);
    const roots = new Set(card.tags.map((tg) => tg.split('/')[0]));
    for (const root of roots) {
      let d = map.get(root);
      if (!d) { d = { new: 0, learning: 0, mature: 0 }; map.set(root, d); }
      d[bucket]++;
    }
  }
  return Array.from(map.entries())
    .map(([tag, b]) => ({ tag, name: tag, due: b.new + b.learning + b.mature, breakdown: b }))
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
}

export function getRecentSessions(ds: DataStore, limit = 7): ReviewSession[] {
  const logs = ds.getReviewLogs();
  const cards = ds.getAllCards();
  const sessionMap = new Map<string, {
    count: number;
    ms: number;
    ratings: Record<Rating, number>;
    tagCounts: Map<string, number>;
  }>();

  for (const log of logs) {
    const date = log.timestamp.slice(0, 10);
    if (!sessionMap.has(date)) {
      sessionMap.set(date, {
        count: 0, ms: 0,
        ratings: { again: 0, hard: 0, good: 0, easy: 0 },
        tagCounts: new Map(),
      });
    }
    const s = sessionMap.get(date)!;
    s.count++;
    s.ms += log.elapsed;
    s.ratings[log.rating]++;
    const card = cards[log.cardId];
    if (card) {
      for (const tag of card.tags) {
        const topTag = tag.split('/')[0];
        s.tagCounts.set(topTag, (s.tagCounts.get(topTag) ?? 0) + 1);
      }
    }
  }

  return Array.from(sessionMap.entries())
    .map(([date, s]) => ({
      date,
      cards: s.count,
      minutes: Math.round(s.ms / 60000),
      ratings: s.count > 0 ? s.ratings : null,
      scope: Array.from(s.tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
