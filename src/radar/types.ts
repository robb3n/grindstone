import { CardData, GrindstoneSettings, ReviewLog } from '../card/types';

export type RadarFamily =
  | 'memory'      // 记忆
  | 'fluency'     // 熟练
  | 'accuracy'    // 准度
  | 'consistency' // 韧性
  | 'throughput'  // 吞吐
  | 'breadth'     // 广度
  | 'depth'       // 深度
  | 'growth'      // 成长
  | 'challenge'   // 挑战
  | 'efficiency'  // 效率
  | 'rhythm'      // 节律
  | 'metacog';    // 心智

export type RadarMetricKey =
  // memory
  | 'retentionLong' | 'recallOld' | 'zeroFailStreak' | 'forgetCurveSlope'
  // fluency
  | 'responseTimeAvg' | 'responseStability' | 'quickAnswerRate'
  // accuracy
  | 'firstTryAccuracy' | 'easyRatio' | 'againControl'
  // consistency
  | 'currentStreak' | 'maxStreak' | 'monthlyCompletion' | 'recoverySpeed'
  // throughput
  | 'totalReviews' | 'dailyAvg' | 'maxDaily'
  // breadth
  | 'masteredCount' | 'tagCount' | 'deckCount'
  // depth
  | 'deepReviewCount' | 'advancedRatio' | 'hardCardRatio'
  // growth
  | 'accuracyGrowth' | 'newToMatureSpeed'
  // challenge
  | 'noSkipRate' | 'proactiveReview' | 'hardFirstRate'
  // efficiency
  | 'cardPerMinute' | 'repsToMastery' | 'scheduleAdherence'
  // rhythm
  | 'timeConcentration' | 'weekdayBalance' | 'sessionLength'
  // metacog
  | 'selfCalibration' | 'ratingHealth';

export type FitLevel = 'high' | 'med' | 'low';
export type FeasLevel = 'yes' | 'part';

export interface MetricCtx {
  cards: Record<string, CardData>;
  reviewLogs: ReviewLog[];
  settings: GrindstoneSettings;
  now: Date;
}

export interface RadarMetric {
  key: RadarMetricKey;
  family: RadarFamily;
  /** Short display label (ZH source-of-truth). */
  label: string;
  labelEn: string;
  /** One-line description shown next to the chip. */
  desc: string;
  descEn: string;
  fit: FitLevel;
  feas: FeasLevel;
  /** Returns value in [0, 1]. Returns null when there is not enough data. */
  compute: (ctx: MetricCtx) => number | null;
}

export interface RadarFamilyMeta {
  id: RadarFamily;
  name: string;        // ZH
  nameEn: string;
  /** "I am X" — sub-headline reinforcing the positive frame. */
  tagline: string;
  taglineEn: string;
}

export interface RadarConfigShape {
  /** Selected metric keys (axis order in the chart). */
  dimensions: RadarMetricKey[];
}
