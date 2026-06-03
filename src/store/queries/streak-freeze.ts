import { DataStore } from '../../storage/data-store';
import { formatDate, addDays } from '../../util/date';

export const FREEZE_CAP = 2;

interface FreezeUpdate {
  streakFreezes: number;
  freezeUsedDates: string[];
  lastFreezeGrantDate: string;
}

/**
 * Idempotent sweep that:
 *   1. Grants weekly freezes for any unclaimed Mondays since lastFreezeGrantDate.
 *   2. Auto-consumes freezes to bridge gap days between the most recent review
 *      and yesterday — one freeze per day, up to the current bank.
 *
 * No-op when strictStreakMode is on. Returns the patch to write (or null if
 * nothing changed), so the caller can decide when to persist.
 */
export function computeFreezeSweep(ds: DataStore, todayD: Date = new Date()): FreezeUpdate | null {
  const settings = ds.getSettings();
  if (settings.strictStreakMode === true) return null;

  const initialFreezes = settings.streakFreezes ?? 0;
  const initialUsed = settings.freezeUsedDates ?? [];
  const initialGrant = settings.lastFreezeGrantDate ?? '';

  // ── Step 1: grant for missed Mondays ──
  const thisMonday = mondayOfWeek(todayD);
  const thisMondayStr = formatDate(thisMonday);

  let freezes = initialFreezes;
  let grantDate = initialGrant;

  if (grantDate !== thisMondayStr) {
    if (grantDate) {
      const last = new Date(grantDate + 'T00:00:00');
      const weeksPassed = Math.max(
        0,
        Math.floor((thisMonday.getTime() - last.getTime()) / (7 * 86400000)),
      );
      freezes = Math.min(FREEZE_CAP, freezes + weeksPassed);
    } else {
      // First time the sweep runs — seed the bank with 1.
      freezes = Math.min(FREEZE_CAP, freezes + 1);
    }
    grantDate = thisMondayStr;
  }

  // ── Step 2: auto-consume to bridge gap ──
  // Walk back from yesterday. For each missed day, consume one freeze.
  // Anchor on the most recent reviewed day STRICTLY before today — so if the
  // user reviewed today after missing yesterday, the gap before today still
  // gets bridged.
  const logs = ds.getReviewLogs();
  const reviewDates = new Set<string>();
  for (const log of logs) {
    reviewDates.add(log.timestamp.slice(0, 10));
  }

  const used = new Set(initialUsed);
  const yesterdayStr = formatDate(addDays(todayD, -1));

  let anchor: string | null = null;
  for (let i = 1; i <= 30; i++) {
    const cs = formatDate(addDays(todayD, -i));
    if (reviewDates.has(cs)) { anchor = cs; break; }
  }

  if (anchor && anchor < yesterdayStr) {
    let cursor = addDays(todayD, -1);
    while (freezes > 0) {
      const cs = formatDate(cursor);
      if (cs <= anchor) break;
      if (!reviewDates.has(cs) && !used.has(cs)) {
        used.add(cs);
        freezes--;
      }
      cursor = addDays(cursor, -1);
    }
  }

  const usedArr = Array.from(used).sort();
  const changed =
    freezes !== initialFreezes ||
    grantDate !== initialGrant ||
    usedArr.length !== initialUsed.length ||
    usedArr.some((v, i) => v !== initialUsed[i]);

  if (!changed) return null;

  return {
    streakFreezes: freezes,
    freezeUsedDates: usedArr,
    lastFreezeGrantDate: grantDate,
  };
}

/** Monday (00:00 local) of the week containing the given date. ISO week (Mon = start). */
function mondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}
