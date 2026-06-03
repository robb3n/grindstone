import { DataStore } from '../../storage/data-store';
import { formatDate, today, addDays } from '../../util/date';

export interface OverviewStats {
  due: number;
  done: number;
  remaining: number;
  streak: number;
  weekMinutes: number;
  tagCount: number;
}

export interface ForecastDay {
  date: string;   // YYYY-MM-DD
  label: string;  // day of month, e.g. "09"
  count: number;
  isToday: boolean;
}

export interface TodayProgress {
  done: number;
  total: number;
}

export interface MaturityData {
  new: number;
  learning: number;
  mature: number;
}

export interface RatingsData {
  again: number;
  hard: number;
  good: number;
  easy: number;
  againPct: number;
  hardPct: number;
  goodPct: number;
  easyPct: number;
}

export interface TagSummary {
  path: string;
  count: number;
}

export function getOverviewStats(ds: DataStore): OverviewStats {
  const t = today();
  const stats = ds.getStats(t);
  const streak = computeStreak(ds);
  const weekMinutes = getWeekStudyMinutes(ds);
  const tagCount = getAllTagPaths(ds).length;
  // After reviewing a card its due date moves forward, so
  // dueToday only counts cards still awaiting review.
  // Original due count = still-due + already-reviewed-today.
  return {
    due: stats.dueToday + stats.reviewedToday,
    done: stats.reviewedToday,
    remaining: stats.dueToday,
    streak,
    weekMinutes,
    tagCount,
  };
}

export function getForecast7D(ds: DataStore): ForecastDay[] {
  const upcoming = ds.getUpcomingDue(7);
  const t = today();
  return upcoming.map((u) => ({
    date: u.date,
    label: u.date.slice(8, 10),
    count: u.count,
    isToday: u.date === t,
  }));
}

export function getTodayProgress(ds: DataStore): TodayProgress {
  const t = today();
  const stats = ds.getStats(t);
  return { done: stats.reviewedToday, total: stats.dueToday + stats.reviewedToday };
}

export function getMaturity(ds: DataStore): MaturityData {
  const dist = ds.getMaturityDistribution();
  return { new: dist.new, learning: dist.learning, mature: dist.mature };
}

export function getRatingsDistribution(ds: DataStore, days?: number): RatingsData {
  const dist = ds.getRatingDistribution(days);
  const total = dist.again + dist.hard + dist.good + dist.easy;
  if (total === 0) {
    return { again: 0, hard: 0, good: 0, easy: 0, againPct: 0, hardPct: 0, goodPct: 0, easyPct: 0 };
  }
  return {
    again: dist.again,
    hard: dist.hard,
    good: dist.good,
    easy: dist.easy,
    againPct: Math.round((dist.again / total) * 100),
    hardPct: Math.round((dist.hard / total) * 100),
    goodPct: Math.round((dist.good / total) * 100),
    easyPct: Math.round((dist.easy / total) * 100),
  };
}

export function get12WeekHeatmap(ds: DataStore): number[] {
  const cells: number[] = [];
  const now = new Date();
  // Start from 12 weeks (84 days) ago, align to Monday
  const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startDate = addDays(now, -(83 + mondayOffset));

  // Collect review counts per day
  const history = ds.getReviewHistory(84 + mondayOffset);
  const dateMap = new Map<string, number>();
  for (const h of history) {
    dateMap.set(h.date, h.count);
  }

  // Fill 84 cells (12 cols x 7 rows), column-major
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 7; row++) {
      const d = addDays(startDate, col * 7 + row);
      const count = dateMap.get(formatDate(d)) ?? 0;
      // Map count to 0..4 intensity
      let intensity: number;
      if (count === 0) intensity = 0;
      else if (count <= 5) intensity = 1;
      else if (count <= 15) intensity = 2;
      else if (count <= 30) intensity = 3;
      else intensity = 4;
      cells.push(intensity);
    }
  }
  return cells;
}

export function getTopTags(ds: DataStore, limit = 8): TagSummary[] {
  const tagMap = new Map<string, number>();
  const cards = ds.getAllCards();
  for (const card of Object.values(cards)) {
    if (card.disabled) continue;
    for (const tag of card.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(tagMap.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function computeStreak(ds: DataStore): number {
  const logs = ds.getReviewLogs();
  if (logs.length === 0) return 0;

  const reviewDates = new Set<string>();
  for (const log of logs) {
    reviewDates.add(log.timestamp.slice(0, 10));
  }

  // In non-strict mode, freeze-bridged days count as active. The sweep that
  // populates freezeUsedDates runs at plugin load (see ensureFreezeState).
  const settings = ds.getSettings();
  const freezeUsed = settings.strictStreakMode === true
    ? new Set<string>()
    : new Set(settings.freezeUsedDates ?? []);
  const isActive = (s: string) => reviewDates.has(s) || freezeUsed.has(s);

  let streak = 0;
  const d = new Date();
  const t = formatDate(d);

  if (isActive(t)) {
    streak++;
  }
  d.setDate(d.getDate() - 1);

  for (let i = 0; i < 365; i++) {
    const dStr = formatDate(d);
    if (!isActive(dStr)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }

  return streak;
}

function getWeekStudyMinutes(ds: DataStore): number {
  const study = ds.getDailyStudyTime(7);
  return Math.round(study.reduce((a, s) => a + s.ms, 0) / 60000);
}

function getAllTagPaths(ds: DataStore): string[] {
  const tags = new Set<string>();
  const cards = ds.getAllCards();
  for (const card of Object.values(cards)) {
    if (card.disabled) continue;
    for (const tag of card.tags) {
      tags.add(tag);
    }
  }
  return Array.from(tags);
}
