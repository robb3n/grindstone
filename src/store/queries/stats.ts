import { DataStore } from '../../storage/data-store';

export interface StatsKPI {
  reviewed: number;
  studyMinutes: number;
  activeDays: number;
  accuracy: number;
  /** Deltas vs previous equal-length period (null if no prior data). */
  reviewedDelta: number | null;
  studyMinutesDelta: number | null;
  activeDaysDelta: number | null;
  accuracyDelta: number | null;
}

export interface ForgettingPoint {
  intervalDays: number;
  retention: number;  // 0..100%
  sampleSize: number;
}

export interface AccuracyByTag {
  tag: string;
  accuracy: number;
  reviewCount: number;
}

export function getStatsKPI(ds: DataStore, days: number): StatsKPI {
  const cur = computeKPIRaw(ds, days);
  // Compute previous period for delta comparison
  const prev = computeKPIRaw(ds, days * 2);
  // prev covers 2x the window — subtract current to get prior period
  const prevReviewed = prev.reviewed - cur.reviewed;
  const prevMinutes = prev.studyMinutes - cur.studyMinutes;
  const prevActive = prev.activeDays - cur.activeDays;

  const hasPrev = prevReviewed > 0 || prevMinutes > 0;

  return {
    ...cur,
    reviewedDelta: hasPrev && prevReviewed > 0
      ? Math.round(((cur.reviewed - prevReviewed) / prevReviewed) * 100)
      : null,
    studyMinutesDelta: hasPrev && prevMinutes > 0
      ? Math.round(((cur.studyMinutes - prevMinutes) / prevMinutes) * 100)
      : null,
    activeDaysDelta: hasPrev
      ? cur.activeDays - prevActive
      : null,
    accuracyDelta: null, // Accuracy delta needs per-period rating split; deferred
  };
}

export function getReviewTrend(ds: DataStore, days: number): Array<{ date: string; count: number }> {
  return ds.getReviewHistory(days);
}

export function getAccuracyByTag(ds: DataStore): AccuracyByTag[] {
  const logs = ds.getReviewLogs();
  const cards = ds.getAllCards();

  const tagStats = new Map<string, { good: number; total: number }>();
  for (const log of logs) {
    const card = cards[log.cardId];
    if (!card || card.disabled) continue;
    for (const tag of card.tags) {
      if (!tagStats.has(tag)) tagStats.set(tag, { good: 0, total: 0 });
      const s = tagStats.get(tag)!;
      s.total++;
      if (log.rating === 'good' || log.rating === 'easy') s.good++;
    }
  }

  return Array.from(tagStats.entries())
    .map(([tag, s]) => ({
      tag,
      accuracy: s.total === 0 ? 0 : Math.round((s.good / s.total) * 100),
      reviewCount: s.total,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount);
}

/**
 * Forgetting curve: at each interval bucket, what % of reviews were good/easy.
 * Buckets: 1, 2, 4, 7, 14, 30, 60, 90 days.
 */
export function getForgettingCurve(ds: DataStore): ForgettingPoint[] {
  const logs = ds.getReviewLogs();
  const cards = ds.getAllCards();
  const buckets = [1, 2, 4, 7, 14, 30, 60, 90];
  const bucketStats = buckets.map(() => ({ good: 0, total: 0 }));

  for (const log of logs) {
    const card = cards[log.cardId];
    if (!card) continue;
    // Best approximation: use the card's current interval since we don't have historical snapshots.
    const interval = card.interval;
    let bestIdx = 0;
    let bestDist = Math.abs(interval - buckets[0]);
    for (let i = 1; i < buckets.length; i++) {
      const dist = Math.abs(interval - buckets[i]);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    bucketStats[bestIdx].total++;
    if (log.rating === 'good' || log.rating === 'easy') {
      bucketStats[bestIdx].good++;
    }
  }

  return buckets
    .map((d, i) => ({
      intervalDays: d,
      retention: bucketStats[i].total === 0
        ? 0
        : Math.round((bucketStats[i].good / bucketStats[i].total) * 100),
      sampleSize: bucketStats[i].total,
    }))
    .filter((p) => p.sampleSize > 0);
}

export function getStudyMinutesTrend(ds: DataStore, days: number): Array<{ date: string; minutes: number }> {
  return ds.getDailyStudyTime(days).map((d) => ({
    date: d.date,
    minutes: Math.round(d.ms / 60000),
  }));
}

function computeKPIRaw(ds: DataStore, days: number): {
  reviewed: number;
  studyMinutes: number;
  activeDays: number;
  accuracy: number;
} {
  const history = ds.getReviewHistory(days);
  const studyTime = ds.getDailyStudyTime(days);
  const ratings = ds.getRatingDistribution(days);

  const reviewed = history.reduce((a, h) => a + h.count, 0);
  const studyMinutes = Math.round(
    studyTime.reduce((a, s) => a + s.ms, 0) / 60000
  );
  const activeDays = history.filter((h) => h.count > 0).length;
  const totalRatings = ratings.again + ratings.hard + ratings.good + ratings.easy;
  const accuracy =
    totalRatings === 0
      ? 0
      : Math.round(((ratings.good + ratings.easy) / totalRatings) * 100);

  return { reviewed, studyMinutes, activeDays, accuracy };
}
