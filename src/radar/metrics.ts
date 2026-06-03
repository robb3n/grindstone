import { CardData, Rating, ReviewLog } from '../card/types';
import { formatDate } from '../util/date';
import {
  MetricCtx, RadarFamily, RadarFamilyMeta, RadarMetric, RadarMetricKey,
} from './types';

// Idle gap that splits review history into sessions. 30 min is the chosen
// threshold from the task brief — see decisions.md once landed.
const SESSION_GAP_MS = 30 * 60 * 1000;
const HARD_FIRST_N = 5;
const HARD_EASE_THRESHOLD = 1.8;
const HARD_AGAIN_RATIO = 0.30;
const HARD_MIN_REVIEWS = 3;

/* ── Family meta ──────────────────────────────────────────────── */

export const FAMILIES: RadarFamilyMeta[] = [
  { id: 'memory',      name: '记忆', nameEn: 'Memory',       tagline: '我记得住',     taglineEn: 'I retain' },
  { id: 'fluency',     name: '熟练', nameEn: 'Fluency',      tagline: '我反应快',     taglineEn: 'I respond fast' },
  { id: 'accuracy',    name: '准度', nameEn: 'Accuracy',     tagline: '我答得对',     taglineEn: 'I answer right' },
  { id: 'consistency', name: '韧性', nameEn: 'Consistency',  tagline: '我不掉链',     taglineEn: 'I never miss' },
  { id: 'throughput',  name: '吞吐', nameEn: 'Throughput',   tagline: '我量管够',     taglineEn: 'I do volume' },
  { id: 'breadth',     name: '广度', nameEn: 'Breadth',      tagline: '我涉猎广',     taglineEn: 'I cover ground' },
  { id: 'depth',       name: '深度', nameEn: 'Depth',        tagline: '我啃硬骨头',   taglineEn: 'I chew the hard' },
  { id: 'growth',      name: '成长', nameEn: 'Growth',       tagline: '我在进步',     taglineEn: 'I improve' },
  { id: 'challenge',   name: '挑战', nameEn: 'Challenge',    tagline: '我主动迎难',   taglineEn: 'I face the heat' },
  { id: 'efficiency',  name: '效率', nameEn: 'Efficiency',   tagline: '投入产出高',   taglineEn: 'I get more per minute' },
  { id: 'rhythm',      name: '节律', nameEn: 'Rhythm',       tagline: '我节奏稳',     taglineEn: 'I keep cadence' },
  { id: 'metacog',     name: '心智', nameEn: 'Metacognition', tagline: '我了解自己',  taglineEn: 'I know myself' },
];

/* ── Normalization helpers ────────────────────────────────────── */

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Soft saturation: 0 → 0, target → ~0.85, target*2 → ~0.95. */
function softCap(value: number, target: number): number {
  if (target <= 0) return 0;
  return clamp01(1 - Math.exp(-value / target * 2));
}

function isCorrect(r: Rating): boolean {
  return r === 'good' || r === 'easy';
}

/* ── Metric registry ──────────────────────────────────────────── */

export const METRICS: RadarMetric[] = [
  /* ── 记忆 Memory ────────────────────────────── */
  {
    key: 'retentionLong', family: 'memory',
    label: '长期保持率', labelEn: 'Long-term retention',
    desc: '间隔 ≥ 7 天后仍答对的比例',
    descEn: 'Correct rate on cards with interval ≥ 7 days',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let total = 0, good = 0;
      for (const log of ctx.reviewLogs) {
        const card = ctx.cards[log.cardId];
        if (!card) continue;
        if (card.interval < 7) continue;
        total++;
        if (isCorrect(log.rating)) good++;
      }
      if (total < 5) return null;
      return clamp01(good / total);
    },
  },
  {
    key: 'recallOld', family: 'memory',
    label: '重出江湖回想率', labelEn: 'Resurfaced recall',
    desc: '间隔 ≥ 30 天卡片的正确率',
    descEn: 'Correct rate on cards with interval ≥ 30 days',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let total = 0, good = 0;
      for (const log of ctx.reviewLogs) {
        const card = ctx.cards[log.cardId];
        if (!card) continue;
        if (card.interval < 30) continue;
        total++;
        if (isCorrect(log.rating)) good++;
      }
      if (total < 3) return null;
      return clamp01(good / total);
    },
  },
  {
    key: 'zeroFailStreak', family: 'memory',
    label: '零失误连击', labelEn: 'Zero-fail streak',
    desc: '历史最长连续正确次数',
    descEn: 'Longest consecutive correct count',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let longest = 0, current = 0;
      for (const log of ctx.reviewLogs) {
        if (isCorrect(log.rating)) {
          current++;
          if (current > longest) longest = current;
        } else {
          current = 0;
        }
      }
      // target: 50 in a row
      return softCap(longest, 50);
    },
  },
  {
    key: 'forgetCurveSlope', family: 'memory',
    label: '遗忘曲线缓度', labelEn: 'Forgetting curve flatness',
    desc: '长间隔卡的正确率接近短间隔 = 曲线平 = 记得牢',
    descEn: 'Long-interval accuracy close to short = flat curve = sticky memory',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let shortGood = 0, shortTotal = 0, longGood = 0, longTotal = 0;
      for (const log of ctx.reviewLogs) {
        const card = ctx.cards[log.cardId];
        if (!card) continue;
        if (card.interval < 7) {
          shortTotal++;
          if (isCorrect(log.rating)) shortGood++;
        } else if (card.interval >= 14) {
          longTotal++;
          if (isCorrect(log.rating)) longGood++;
        }
      }
      if (shortTotal < 5 || longTotal < 5) return null;
      const shortRet = shortGood / shortTotal;
      const longRet = longGood / longTotal;
      // delta = drop from short → long. Flat curve: delta ≈ 0 → 1.0.
      // 40pp drop → 0. Negative deltas (long > short) clamp to 1.
      const delta = shortRet - longRet;
      return clamp01(1 - delta / 0.4);
    },
  },

  /* ── 熟练 Fluency ───────────────────────────── */
  {
    key: 'responseTimeAvg', family: 'fluency',
    label: '平均响应时间', labelEn: 'Average response time',
    desc: '翻面到打分耗时（越短越熟）',
    descEn: 'Flip-to-rate latency (shorter = fluent)',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const elapsedList = ctx.reviewLogs.map(l => l.elapsed).filter(e => e > 0 && e < 60_000);
      if (elapsedList.length < 5) return null;
      const avgMs = elapsedList.reduce((a, b) => a + b, 0) / elapsedList.length;
      // 1s → 1.0, 10s → 0.0
      return clamp01(1 - (avgMs / 1000 - 1) / 9);
    },
  },
  {
    key: 'responseStability', family: 'fluency',
    label: '响应稳定性', labelEn: 'Response stability',
    desc: '反应时方差小 = 真熟而非偶中',
    descEn: 'Low variance = consistent fluency',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const elapsedList = ctx.reviewLogs.map(l => l.elapsed).filter(e => e > 0 && e < 60_000);
      if (elapsedList.length < 10) return null;
      const mean = elapsedList.reduce((a, b) => a + b, 0) / elapsedList.length;
      const variance = elapsedList.reduce((a, b) => a + (b - mean) ** 2, 0) / elapsedList.length;
      const cv = Math.sqrt(variance) / Math.max(mean, 1); // coefficient of variation
      // cv 0.3 → 0.9, cv 1.5 → 0
      return clamp01(1 - (cv - 0.3) / 1.2);
    },
  },
  {
    key: 'quickAnswerRate', family: 'fluency',
    label: '秒答率', labelEn: 'Snap-answer rate',
    desc: '< 2 秒 Good/Easy 的占比',
    descEn: '< 2s with Good/Easy share',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let total = 0, snap = 0;
      for (const log of ctx.reviewLogs) {
        if (log.elapsed <= 0) continue;
        total++;
        if (log.elapsed < 2000 && isCorrect(log.rating)) snap++;
      }
      if (total < 5) return null;
      return clamp01(snap / total);
    },
  },

  /* ── 准度 Accuracy ──────────────────────────── */
  {
    key: 'firstTryAccuracy', family: 'accuracy',
    label: '首答正确率', labelEn: 'First-try accuracy',
    desc: '新卡或已掌握卡首次翻出的正确率',
    descEn: 'Correct rate on first encounter of cards',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const dist = countRatings(ctx);
      const total = dist.again + dist.hard + dist.good + dist.easy;
      if (total < 5) return null;
      return clamp01((dist.good + dist.easy) / total);
    },
  },
  {
    key: 'easyRatio', family: 'accuracy',
    label: 'Easy 比例', labelEn: 'Easy share',
    desc: '自评 Easy 的占比（含信心）',
    descEn: 'Share of Easy self-ratings (confidence)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const dist = countRatings(ctx);
      const total = dist.again + dist.hard + dist.good + dist.easy;
      if (total < 5) return null;
      // target: 30% Easy is excellent
      return clamp01((dist.easy / total) / 0.30);
    },
  },
  {
    key: 'againControl', family: 'accuracy',
    label: 'Again 控制率', labelEn: 'Again control',
    desc: 'Again 占比的倒数（越低越好）',
    descEn: 'Inverse of Again share (lower = better)',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const dist = countRatings(ctx);
      const total = dist.again + dist.hard + dist.good + dist.easy;
      if (total < 5) return null;
      return clamp01(1 - (dist.again / total));
    },
  },

  /* ── 韧性 Consistency ───────────────────────── */
  {
    key: 'currentStreak', family: 'consistency',
    label: '连续学习天数', labelEn: 'Current streak',
    desc: '今天为止的连续打卡天数',
    descEn: 'Consecutive active days up to today',
    fit: 'high', feas: 'yes',
    compute: (ctx) => softCap(currentStreak(ctx), 30),
  },
  {
    key: 'maxStreak', family: 'consistency',
    label: '历史最长 streak', labelEn: 'All-time streak',
    desc: '截至目前最长连续打卡天数',
    descEn: 'Longest consecutive run ever',
    fit: 'high', feas: 'yes',
    compute: (ctx) => softCap(maxStreak(ctx), 60),
  },
  {
    key: 'monthlyCompletion', family: 'consistency',
    label: '月完成率', labelEn: 'Monthly completion',
    desc: '近 30 天里有学习的天数比例',
    descEn: 'Share of active days in last 30 days',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const days = activeDaysInWindow(ctx, 30);
      return clamp01(days / 30);
    },
  },
  {
    key: 'recoverySpeed', family: 'consistency',
    label: '断更恢复速度', labelEn: 'Recovery speed',
    desc: '断更后多久重启（越短越好）',
    descEn: 'Days to return after a gap (shorter = better)',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const dates = activeDateSet(ctx);
      if (dates.size < 3) return null;
      const sorted = Array.from(dates).sort();
      // Find gaps and the next active day after each
      let totalGaps = 0;
      let sumDelay = 0;
      for (let i = 1; i < sorted.length; i++) {
        const diff = daysBetween(sorted[i - 1], sorted[i]);
        if (diff > 1) {
          totalGaps++;
          sumDelay += diff - 1;
        }
      }
      if (totalGaps === 0) return 1; // never broke streak
      const avgDelay = sumDelay / totalGaps;
      // 1 day → 0.9, 7 days → 0
      return clamp01(1 - (avgDelay - 1) / 7);
    },
  },

  /* ── 吞吐 Throughput ────────────────────────── */
  {
    key: 'totalReviews', family: 'throughput',
    label: '累计复习次数', labelEn: 'Total reviews',
    desc: '历史 review 总数',
    descEn: 'All-time review count',
    fit: 'med', feas: 'yes',
    compute: (ctx) => softCap(ctx.reviewLogs.length, 2000),
  },
  {
    key: 'dailyAvg', family: 'throughput',
    label: '日均卡数', labelEn: 'Daily average',
    desc: '近 30 天日均复习数',
    descEn: 'Avg reviews/day over last 30 days',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const counts = dailyCountsInWindow(ctx, 30);
      const total = counts.reduce((a, b) => a + b, 0);
      const avg = total / 30;
      return softCap(avg, 25);
    },
  },
  {
    key: 'maxDaily', family: 'throughput',
    label: '单日最高量', labelEn: 'Peak day',
    desc: '一日内最多复习数',
    descEn: 'Most reviews completed in a single day',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const dateCount = new Map<string, number>();
      for (const log of ctx.reviewLogs) {
        const d = log.timestamp.slice(0, 10);
        dateCount.set(d, (dateCount.get(d) ?? 0) + 1);
      }
      let max = 0;
      for (const n of dateCount.values()) if (n > max) max = n;
      return softCap(max, 80);
    },
  },

  /* ── 广度 Breadth ───────────────────────────── */
  {
    key: 'masteredCount', family: 'breadth',
    label: '掌握卡片总数', labelEn: 'Mastered cards',
    desc: '间隔 ≥ 21 天的卡片数（mature）',
    descEn: 'Cards with interval ≥ 21 days (mature)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let count = 0;
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        if (card.interval >= 21) count++;
      }
      return softCap(count, 200);
    },
  },
  {
    key: 'tagCount', family: 'breadth',
    label: '涉及主题数', labelEn: 'Topics covered',
    desc: '覆盖的 tag 数量',
    descEn: 'Number of distinct tags used',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const tags = new Set<string>();
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        for (const tag of card.tags) tags.add(tag);
      }
      return softCap(tags.size, 40);
    },
  },
  {
    key: 'deckCount', family: 'breadth',
    label: '学科跨度', labelEn: 'Deck span',
    desc: '不同顶级 deck 数（顶级标签）',
    descEn: 'Distinct top-level decks',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const decks = new Set<string>();
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        for (const tag of card.tags) {
          decks.add(tag.split('/')[0]);
        }
      }
      return softCap(decks.size, 8);
    },
  },

  /* ── 深度 Depth ─────────────────────────────── */
  {
    key: 'deepReviewCount', family: 'depth',
    label: '深度复习卡数', labelEn: 'Deep-review cards',
    desc: '复习 ≥ 5 次的卡数',
    descEn: 'Cards reviewed ≥ 5 times',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      let count = 0;
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        if (card.reviewCount >= 5) count++;
      }
      return softCap(count, 100);
    },
  },
  {
    key: 'advancedRatio', family: 'depth',
    label: '进阶卡占比', labelEn: 'Advanced share',
    desc: '高 ease (≥ 2.6) 的卡比例',
    descEn: 'Cards with ease ≥ 2.6',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let total = 0, advanced = 0;
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        if (card.reviewCount === 0) continue;
        total++;
        if (card.ease >= 2.6) advanced++;
      }
      if (total < 3) return null;
      return clamp01(advanced / total);
    },
  },
  {
    key: 'hardCardRatio', family: 'depth',
    label: '高难卡占比', labelEn: 'Hard-card share',
    desc: 'ease ≤ 1.8 或 Again 占比 ≥ 30% 的卡比例',
    descEn: 'Share of cards with ease ≤ 1.8 or Again rate ≥ 30%',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const againStats = perCardAgainStats(ctx);
      let total = 0, hard = 0;
      for (const [id, card] of Object.entries(ctx.cards)) {
        if (card.disabled) continue;
        if (card.reviewCount === 0) continue;
        total++;
        if (isHardCard(card, againStats.get(id))) hard++;
      }
      if (total < 5) return null;
      return clamp01(hard / total);
    },
  },

  /* ── 成长 Growth ────────────────────────────── */
  {
    key: 'accuracyGrowth', family: 'growth',
    label: '正确率提升', labelEn: 'Accuracy growth',
    desc: '近 30 天 vs 之前的正确率提升',
    descEn: 'Last 30d vs prior accuracy delta',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const cutoff = msAgo(ctx.now, 30);
      let recT = 0, recG = 0, oldT = 0, oldG = 0;
      const cutoffStr = formatDate(new Date(cutoff));
      for (const log of ctx.reviewLogs) {
        const ds = log.timestamp.slice(0, 10);
        if (ds >= cutoffStr) {
          recT++;
          if (isCorrect(log.rating)) recG++;
        } else {
          oldT++;
          if (isCorrect(log.rating)) oldG++;
        }
      }
      if (recT < 10 || oldT < 10) return null;
      const recAcc = recG / recT;
      const oldAcc = oldG / oldT;
      // delta of +20pp → 1.0; delta of -10pp → 0
      return clamp01((recAcc - oldAcc + 0.10) / 0.30);
    },
  },
  {
    key: 'newToMatureSpeed', family: 'growth',
    label: '新→熟卡速度', labelEn: 'New-to-mature speed',
    desc: '掌握的卡平均要几次复习达到（越少越好）',
    descEn: 'Avg reviews to reach mature (lower = better)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const repsList: number[] = [];
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        if (card.interval < 21) continue;
        if (card.reviewCount === 0) continue;
        repsList.push(card.reviewCount);
      }
      if (repsList.length < 3) return null;
      const avg = repsList.reduce((a, b) => a + b, 0) / repsList.length;
      // 5 reps → 1.0, 20 reps → 0
      return clamp01(1 - (avg - 5) / 15);
    },
  },

  /* ── 挑战 Challenge ─────────────────────────── */
  {
    key: 'noSkipRate', family: 'challenge',
    label: '不跳过率', labelEn: 'No-skip rate',
    desc: '近 7 天有学习的天里 due 卡完成比例',
    descEn: 'Share of due cards finished on active days (7d)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      // Approximation: on days with any review, how many cards did the user
      // clear vs cards that were due at the time. We use a rolling 7-day
      // window of review counts as a proxy for engagement intensity.
      const counts = dailyCountsInWindow(ctx, 7);
      const active = counts.filter(c => c > 0).length;
      if (active === 0) return null;
      // Hard to compute "due at the time"; treat as active-day density (proxy)
      return clamp01(active / 7);
    },
  },
  {
    key: 'proactiveReview', family: 'challenge',
    label: '主动复习率', labelEn: 'Proactive review',
    desc: '在 due 日之前主动复习的占比（需 1.12.0+ 的 due 快照）',
    descEn: 'Share of reviews done before due date (needs 1.12.0+ snapshots)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      let total = 0, proactive = 0;
      for (const log of ctx.reviewLogs) {
        if (!log.dueAtReview) continue;
        total++;
        const logDate = log.timestamp.slice(0, 10);
        if (logDate < log.dueAtReview) proactive++;
      }
      if (total < 10) return null;
      // Direct ratio: 100% proactive = 1.0. Most users sit far below.
      return clamp01(proactive / total);
    },
  },
  {
    key: 'hardFirstRate', family: 'challenge',
    label: '难卡先做率', labelEn: 'Hard-first rate',
    desc: '每节前 5 张里难卡占比 (30%+ 视为优秀)',
    descEn: 'Hard-card share in first 5 of each session (30%+ = strong)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const sessions = splitSessions(ctx.reviewLogs);
      const againStats = perCardAgainStats(ctx);
      const ratios: number[] = [];
      for (const session of sessions) {
        if (session.length < HARD_FIRST_N) continue;
        const first = session.slice(0, HARD_FIRST_N);
        let hardCount = 0;
        for (const log of first) {
          const card = ctx.cards[log.cardId];
          if (!card) continue;
          if (isHardCard(card, againStats.get(log.cardId))) hardCount++;
        }
        ratios.push(hardCount / HARD_FIRST_N);
      }
      if (ratios.length < 3) return null;
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      // 30% hard cards first = 1.0; linear below.
      return clamp01(avg / 0.30);
    },
  },

  /* ── 效率 Efficiency ────────────────────────── */
  {
    key: 'cardPerMinute', family: 'efficiency',
    label: '每分钟掌握卡数', labelEn: 'Cards per minute',
    desc: '近 30 天平均每分钟复习的卡数',
    descEn: 'Avg cards/minute over last 30 days',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const cutoffStr = formatDate(new Date(msAgo(ctx.now, 30)));
      let cards = 0, ms = 0;
      for (const log of ctx.reviewLogs) {
        const ds = log.timestamp.slice(0, 10);
        if (ds < cutoffStr) continue;
        if (log.elapsed <= 0) continue;
        cards++;
        ms += log.elapsed;
      }
      if (ms <= 0 || cards < 5) return null;
      const cpm = cards / (ms / 60_000);
      // 5 cpm → 0.5, 20 cpm → 1.0
      return softCap(cpm, 12);
    },
  },
  {
    key: 'repsToMastery', family: 'efficiency',
    label: '掌握所需次数', labelEn: 'Reps to mastery',
    desc: '已掌握卡片的平均复习次数（越少越好）',
    descEn: 'Avg reps among mastered cards (lower = better)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      const reps: number[] = [];
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        if (card.interval < 21) continue;
        reps.push(card.reviewCount);
      }
      if (reps.length < 3) return null;
      const avg = reps.reduce((a, b) => a + b, 0) / reps.length;
      return clamp01(1 - (avg - 4) / 16);
    },
  },
  {
    key: 'scheduleAdherence', family: 'efficiency',
    label: '计划遵循度', labelEn: 'Schedule adherence',
    desc: '按 SRS 安排准时复习的比例（不积压）',
    descEn: 'Share of cards not overdue',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const todayStr = formatDate(ctx.now);
      let total = 0, onTime = 0;
      for (const card of Object.values(ctx.cards)) {
        if (card.disabled) continue;
        if (card.reviewCount === 0) continue;
        total++;
        // Card is "on schedule" if its due date is today or in the future
        if (card.due >= todayStr) onTime++;
      }
      if (total < 3) return null;
      return clamp01(onTime / total);
    },
  },

  /* ── 节律 Rhythm ────────────────────────────── */
  {
    key: 'timeConcentration', family: 'rhythm',
    label: '学习时段集中度', labelEn: 'Time-of-day focus',
    desc: '是否有稳定学习时段（越集中越好）',
    descEn: 'Concentration of preferred study hour',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      if (ctx.reviewLogs.length < 20) return null;
      const hours = new Array(24).fill(0);
      for (const log of ctx.reviewLogs) {
        const h = parseInt(log.timestamp.slice(11, 13), 10);
        if (Number.isFinite(h)) hours[h]++;
      }
      const total = hours.reduce((a, b) => a + b, 0);
      if (total === 0) return null;
      // Compute entropy; lower entropy = more concentration
      let entropy = 0;
      for (const h of hours) {
        if (h === 0) continue;
        const p = h / total;
        entropy -= p * Math.log2(p);
      }
      // Max entropy is log2(24) ≈ 4.58; min is 0 (single hour).
      // Map: entropy 2.0 → 0.8, entropy 4.5 → 0
      return clamp01(1 - entropy / 4.58);
    },
  },
  {
    key: 'weekdayBalance', family: 'rhythm',
    label: '周末工作日均衡', labelEn: 'Weekday balance',
    desc: '工作日与周末的学习平衡度',
    descEn: 'Balance between weekdays and weekends',
    fit: 'low', feas: 'yes',
    compute: (ctx) => {
      if (ctx.reviewLogs.length < 14) return null;
      let weekday = 0, weekend = 0;
      for (const log of ctx.reviewLogs) {
        const d = new Date(log.timestamp);
        const dow = d.getDay();
        if (dow === 0 || dow === 6) weekend++;
        else weekday++;
      }
      const total = weekday + weekend;
      if (total === 0) return null;
      // Expected: weekday ratio ≈ 5/7. Score by closeness to ideal mix.
      const ratio = weekday / total;
      const ideal = 5 / 7;
      const diff = Math.abs(ratio - ideal);
      return clamp01(1 - diff / ideal);
    },
  },
  {
    key: 'sessionLength', family: 'rhythm',
    label: '会话长度合理性', labelEn: 'Session-length sanity',
    desc: '会话平均长度落在 15-45 分钟得高分',
    descEn: 'Avg session duration in the 15-45 min sweet spot',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const sessions = splitSessions(ctx.reviewLogs);
      const durations: number[] = [];
      for (const s of sessions) {
        if (s.length < 2) continue;
        const first = new Date(s[0].timestamp).getTime();
        const last = new Date(s[s.length - 1].timestamp).getTime();
        durations.push((last - first) / 60_000);
      }
      if (durations.length < 3) return null;
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      return scoreSessionLength(avg);
    },
  },

  /* ── 心智 Metacognition ─────────────────────── */
  {
    key: 'selfCalibration', family: 'metacog',
    label: '自评校准度', labelEn: 'Self-calibration',
    desc: '评 Easy 后下次仍答对的概率',
    descEn: 'P(next correct | this Easy)',
    fit: 'high', feas: 'yes',
    compute: (ctx) => {
      // For each Easy log on a card, look at the next log of the same card:
      // did the user still get good/easy?
      const byCard = new Map<string, typeof ctx.reviewLogs>();
      for (const log of ctx.reviewLogs) {
        const arr = byCard.get(log.cardId) ?? [];
        arr.push(log);
        byCard.set(log.cardId, arr);
      }
      let easyFollowups = 0, easyFollowupsCorrect = 0;
      for (const logs of byCard.values()) {
        logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        for (let i = 0; i < logs.length - 1; i++) {
          if (logs[i].rating === 'easy') {
            easyFollowups++;
            if (isCorrect(logs[i + 1].rating)) easyFollowupsCorrect++;
          }
        }
      }
      if (easyFollowups < 5) return null;
      return clamp01(easyFollowupsCorrect / easyFollowups);
    },
  },
  {
    key: 'ratingHealth', family: 'metacog',
    label: '评分分布健康度', labelEn: 'Rating distribution health',
    desc: 'Again/Hard/Good/Easy 分布是否合理',
    descEn: 'Healthy spread of Again/Hard/Good/Easy',
    fit: 'med', feas: 'yes',
    compute: (ctx) => {
      const dist = countRatings(ctx);
      const total = dist.again + dist.hard + dist.good + dist.easy;
      if (total < 20) return null;
      // Ideal: ~10% again, ~15% hard, ~55% good, ~20% easy
      const ideal = { again: 0.10, hard: 0.15, good: 0.55, easy: 0.20 };
      const actual = {
        again: dist.again / total,
        hard:  dist.hard  / total,
        good:  dist.good  / total,
        easy:  dist.easy  / total,
      };
      let diff = 0;
      diff += Math.abs(actual.again - ideal.again);
      diff += Math.abs(actual.hard  - ideal.hard);
      diff += Math.abs(actual.good  - ideal.good);
      diff += Math.abs(actual.easy  - ideal.easy);
      // diff range 0 (perfect) to 2 (worst). Map 0 → 1, 1 → 0.
      return clamp01(1 - diff);
    },
  },
];

export const METRIC_MAP: Record<RadarMetricKey, RadarMetric> = Object.fromEntries(
  METRICS.map(m => [m.key, m]),
) as Record<RadarMetricKey, RadarMetric>;

export function metricsByFamily(family: RadarFamily): RadarMetric[] {
  return METRICS.filter(m => m.family === family);
}

/* ── Helpers ──────────────────────────────────────────────────── */

function countRatings(ctx: MetricCtx): Record<Rating, number> {
  const out: Record<Rating, number> = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const log of ctx.reviewLogs) {
    out[log.rating]++;
  }
  return out;
}

function activeDateSet(ctx: MetricCtx): Set<string> {
  const set = new Set<string>();
  for (const log of ctx.reviewLogs) set.add(log.timestamp.slice(0, 10));
  return set;
}

function activeDaysInWindow(ctx: MetricCtx, days: number): number {
  const cutoff = formatDate(new Date(msAgo(ctx.now, days - 1)));
  const set = new Set<string>();
  for (const log of ctx.reviewLogs) {
    const ds = log.timestamp.slice(0, 10);
    if (ds >= cutoff) set.add(ds);
  }
  return set.size;
}

function dailyCountsInWindow(ctx: MetricCtx, days: number): number[] {
  const counts: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(ctx.now);
    d.setDate(d.getDate() - i);
    const ds = formatDate(d);
    let n = 0;
    for (const log of ctx.reviewLogs) {
      if (log.timestamp.slice(0, 10) === ds) n++;
    }
    counts.push(n);
  }
  return counts;
}

function currentStreak(ctx: MetricCtx): number {
  const dates = activeDateSet(ctx);
  const freezeUsed = new Set(ctx.settings.freezeUsedDates ?? []);
  const isActive = (s: string) => dates.has(s) || freezeUsed.has(s);
  let streak = 0;
  const d = new Date(ctx.now);
  if (isActive(formatDate(d))) streak++;
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    if (!isActive(formatDate(d))) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function maxStreak(ctx: MetricCtx): number {
  const dates = Array.from(activeDateSet(ctx)).sort();
  if (dates.length === 0) return 0;
  let longest = 1, current = 1;
  for (let i = 1; i < dates.length; i++) {
    if (daysBetween(dates[i - 1], dates[i]) === 1) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function msAgo(now: Date, days: number): number {
  return now.getTime() - days * 86_400_000;
}

/**
 * Split review logs into sessions by SESSION_GAP_MS idle gap. Logs are sorted
 * by timestamp ASC; the boundary triggers whenever the gap exceeds the cutoff.
 */
function splitSessions(logs: ReviewLog[]): ReviewLog[][] {
  if (logs.length === 0) return [];
  const sorted = [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const sessions: ReviewLog[][] = [];
  let current: ReviewLog[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].timestamp).getTime();
    const cur = new Date(sorted[i].timestamp).getTime();
    if (cur - prev > SESSION_GAP_MS) {
      sessions.push(current);
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  sessions.push(current);
  return sessions;
}

interface AgainStats { again: number; total: number }

function perCardAgainStats(ctx: MetricCtx): Map<string, AgainStats> {
  const m = new Map<string, AgainStats>();
  for (const log of ctx.reviewLogs) {
    let s = m.get(log.cardId);
    if (!s) { s = { again: 0, total: 0 }; m.set(log.cardId, s); }
    s.total++;
    if (log.rating === 'again') s.again++;
  }
  return m;
}

function isHardCard(card: CardData, stats: AgainStats | undefined): boolean {
  if (card.ease <= HARD_EASE_THRESHOLD) return true;
  if (!stats || stats.total === 0) return false;
  if (card.reviewCount >= HARD_MIN_REVIEWS &&
      stats.again / stats.total >= HARD_AGAIN_RATIO) return true;
  return false;
}

/**
 * Piecewise scoring: < 5min or > 90min → 0; 15-45min → 1.0; ramps elsewhere.
 */
function scoreSessionLength(min: number): number {
  if (min < 5 || min > 90) return 0;
  if (min >= 15 && min <= 45) return 1;
  if (min < 15) return (min - 5) / 10;          // 5 → 0, 15 → 1
  if (min <= 60) return 1 - (min - 45) / 30;    // 45 → 1, 60 → 0.5
  return 0.5 - (min - 60) / 60;                 // 60 → 0.5, 90 → 0
}
