import type { LicenseData } from '../license/types';

export interface CardData {
  file: string;
  blockTitle: string;
  blockStartLine?: number;
  tags: string[];
  interval: number;
  ease: number;
  due: string;          // ISO date string YYYY-MM-DD
  lastReviewed: string; // ISO date string YYYY-MM-DD
  reviewCount: number;
  createdAt: string;    // ISO date string YYYY-MM-DD
  disabled?: boolean;
  /** True when the card's note has an archive tag — excluded from auto-review queue but still drillable via cram. */
  archived?: boolean;
  /**
   * Active-review (cram) stats. Strictly separate from SRS fields above —
   * written only by cram-engine, never read by sm2/schedule. Absent on cards
   * the user has never crammed.
   */
  cram?: CramStats;
}

export interface CramStats {
  count: number;          // total cram rates (any button)
  lastAt: number;         // epoch ms of last cram rate
  againCount: number;     // cumulative Again presses
  correctCount: number;   // cumulative Good + Easy presses
}

export interface CardState {
  interval: number;
  ease: number;
  reviewCount: number;
}

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface SrsParams {
  initialEase: number;
  minEase: number;
  easeBonus: number;
  easeGoodDelta: number;
  easeHardPenalty: number;
  againPenalty: number;
  hardMultiplier: number;
  graduatingInterval: number;
  easyInterval: number;
  againInterval: number;
  step1Interval: number;
  step2Interval: number;
  /**
   * Global multiplier on multiplicatively-grown good/easy intervals (Anki-style
   * interval modifier). Optional and defaults to 1 at the use site, so persisted
   * deck params and DEFAULT_SRS_PARAMS (both longterm-equivalent) keep behavior.
   * goal=sprint sets it below 1 to keep intervals short on the good path too —
   * which is otherwise governed purely by intensity, leaving goal invisible there.
   */
  intervalModifier?: number;
}

export const DEFAULT_SRS_PARAMS: SrsParams = {
  initialEase: 2.5,
  minEase: 1.3,
  easeBonus: 0.15,
  easeGoodDelta: 0,
  easeHardPenalty: 0.15,
  againPenalty: 0.20,
  hardMultiplier: 1.2,
  graduatingInterval: 1,
  easyInterval: 4,
  againInterval: 0,
  step1Interval: 3,
  step2Interval: 6,
};

export interface SrsPreset {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  /**
   * Optional i18n key for the description. When present, callers should look it
   * up via `t(descriptionKey)` so the localized version wins over the literal
   * `description` (which is the ZH source-of-truth, kept for back-compat).
   */
  descriptionKey?: string;
  params: SrsParams;
  builtin: boolean;
}

export const BUILTIN_PRESETS: SrsPreset[] = [
  {
    id: 'sm2-default',
    name: '默认 SM-2',
    nameEn: 'Default SM-2',
    description: '经典 SM-2 参数，平衡记忆效率与复习压力',
    descriptionKey: 'preset.sm2_default.desc',
    params: { ...DEFAULT_SRS_PARAMS },
    builtin: true,
  },
  {
    id: 'anki-standard',
    name: 'Anki 标准',
    nameEn: 'Anki Standard',
    description: '模拟 Anki 默认参数，适合从 Anki 迁移的用户',
    descriptionKey: 'preset.anki_standard.desc',
    params: {
      ...DEFAULT_SRS_PARAMS,
      step1Interval: 4,
      step2Interval: 6,
    },
    builtin: true,
  },
  {
    id: 'high-frequency',
    name: '高频巩固',
    nameEn: 'High Frequency',
    description: '更短间隔、更严惩罚，适合考前冲刺或易遗忘内容',
    descriptionKey: 'preset.high_freq.desc',
    params: {
      initialEase: 2.2,
      minEase: 1.3,
      easeBonus: 0.10,
      easeGoodDelta: 0,
      easeHardPenalty: 0.20,
      againPenalty: 0.30,
      hardMultiplier: 1.1,
      graduatingInterval: 1,
      easyInterval: 3,
      againInterval: 0,
      step1Interval: 2,
      step2Interval: 4,
    },
    builtin: true,
  },
  {
    id: 'gentle',
    name: '轻松记忆',
    nameEn: 'Gentle Memory',
    description: '更长间隔、较轻惩罚，适合长线记忆或低压学习',
    descriptionKey: 'preset.relaxed.desc',
    params: {
      initialEase: 2.7,
      minEase: 1.5,
      easeBonus: 0.20,
      easeGoodDelta: 0.05,
      easeHardPenalty: 0.10,
      againPenalty: 0.15,
      hardMultiplier: 1.3,
      graduatingInterval: 2,
      easyInterval: 5,
      againInterval: 1,
      step1Interval: 4,
      step2Interval: 8,
    },
    builtin: true,
  },
];

export type IntentIntensity = 1 | 2 | 3 | 4 | 5;
export type IntentTolerance = 'strict' | 'std' | 'lenient';
export type IntentStart     = 'dense' | 'std' | 'spaced';
export type IntentGoal      = 'sprint' | 'longterm';

export interface SrsIntent {
  intensity: IntentIntensity;
  tolerance: IntentTolerance;
  start:     IntentStart;
  goal:      IntentGoal;
}

export const DEFAULT_INTENT: SrsIntent = {
  intensity: 3,
  tolerance: 'std',
  start:     'std',
  goal:      'longterm',
};

export interface IntentRecipe {
  id: string;
  ico: string;
  nm: string;
  nmEn?: string;
  sub: string;
  subEn?: string;
  intent: SrsIntent;
  builtin: boolean;
}

export const BUILTIN_INTENT_RECIPES: IntentRecipe[] = [
  { id: 'exam',     ico: '📚', nm: '大学期末',   nmEn: 'Final Exam',          sub: '2 周冲刺', subEn: '2-week sprint',          builtin: true, intent: { intensity: 4, tolerance: 'strict',  start: 'dense',  goal: 'sprint'   } },
  { id: 'kaoyan',   ico: '🎯', nm: '考研专业课', nmEn: 'Postgrad Major Course', sub: '长线高强度', subEn: 'Long-haul high intensity', builtin: true, intent: { intensity: 4, tolerance: 'strict',  start: 'dense',  goal: 'longterm' } },
  { id: 'ielts',    ico: '🎓', nm: '雅思冲刺',   nmEn: 'IELTS Sprint',        sub: '高频温和', subEn: 'Frequent & gentle',      builtin: true, intent: { intensity: 4, tolerance: 'std',     start: 'std',    goal: 'longterm' } },
  { id: 'prog',     ico: '💻', nm: '编程八股',   nmEn: 'Programming concepts', sub: '中频长期', subEn: 'Mid-frequency, long-term', builtin: true, intent: { intensity: 3, tolerance: 'std',     start: 'std',    goal: 'longterm' } },
  { id: 'vocab',    ico: '🌐', nm: '外语词汇',   nmEn: 'Foreign vocabulary',  sub: '超长期',   subEn: 'Very long-term',         builtin: true, intent: { intensity: 2, tolerance: 'std',     start: 'spaced', goal: 'longterm' } },
  { id: 'japanese', ico: '🈸', nm: '日语五十音', nmEn: 'Japanese kana',       sub: '短间隔',   subEn: 'Short intervals',        builtin: true, intent: { intensity: 5, tolerance: 'strict',  start: 'dense',  goal: 'sprint'   } },
  { id: 'poem',     ico: '📜', nm: '古诗文',     nmEn: 'Classical poems',     sub: '背诵向',   subEn: 'Memorization',           builtin: true, intent: { intensity: 4, tolerance: 'strict',  start: 'std',    goal: 'longterm' } },
  { id: 'law',      ico: '⚖️', nm: '法考记忆',   nmEn: 'Legal exam',          sub: '高强度',   subEn: 'High intensity',         builtin: true, intent: { intensity: 5, tolerance: 'strict',  start: 'dense',  goal: 'longterm' } },
  { id: 'tcm',      ico: '🩺', nm: '中医背方',   nmEn: 'TCM formulas',        sub: '严格容错', subEn: 'Strict tolerance',       builtin: true, intent: { intensity: 4, tolerance: 'strict',  start: 'std',    goal: 'longterm' } },
  { id: 'gentle',   ico: '🌳', nm: '终身记忆',   nmEn: 'Lifelong',            sub: '最低压力', subEn: 'Lowest pressure',        builtin: true, intent: { intensity: 1, tolerance: 'lenient', start: 'spaced', goal: 'longterm' } },
];

export type Maturity = 'new' | 'learning' | 'mature';

/** Classify a card's SRS maturity. Single source of truth for the 21-day
 *  learning→mature threshold (used by due/overall breakdowns and the review
 *  scope picker). */
export function maturityBucket(card: Pick<CardData, 'reviewCount' | 'interval'>): Maturity {
  if (card.reviewCount === 0) return 'new';
  if (card.interval < 21) return 'learning';
  return 'mature';
}

/** Legacy single-select maturity filter — 'all' = no constraint. Kept for
 *  back-compat: old decks / cram sessions persisted this string form. New code
 *  uses the multi-select `Maturity[]` and reads legacy data via normMaturity(). */
export type MaturityFilter = 'all' | Maturity;

/** Three-dimension filter snapshot shared by Tags tab and CustomDeck. */
export interface DeckFilter {
  tags: string[];          // selected tag paths (multi-select within one top-level family)
  search: string;          // free-text search
  /**
   * Selected maturity buckets. `[]` (or all three) = no constraint ("全部").
   * Persisted as an array since the multi-select redesign; legacy decks stored
   * a single MaturityFilter string — always read through normMaturity().
   */
  maturity: Maturity[];
}

/** Normalize a possibly-legacy maturity field to a bucket array. `[]` = all. */
export function normMaturity(m: unknown): Maturity[] {
  if (Array.isArray(m)) {
    return m.filter((x): x is Maturity => x === 'new' || x === 'learning' || x === 'mature');
  }
  if (m === 'new' || m === 'learning' || m === 'mature') return [m];
  return []; // 'all', undefined, null, etc.
}

export interface CustomDeck {
  id: string;
  name: string;
  filter: DeckFilter;
  createdAt: number;       // epoch ms
  order: number;           // user-drag order; lower = earlier
  icon?: string;           // optional emoji
}

export interface CramSession {
  id: string;
  startedAt: number;       // epoch ms
  endedAt: number;         // epoch ms
  deckId?: string;         // present when session was launched from a CustomDeck
  filter: DeckFilter;      // three-dim filter snapshot at launch
  totalCards: number;      // total rates (Again repeats counted)
  uniqueCards: number;     // distinct cards rated at least once
  correctCount: number;    // Good + Easy
  againCount: number;      // Again
  durationMs: number;      // endedAt - startedAt
}

export interface StoreStats {
  total: number;
  active: number;
  disabled: number;
  dueToday: number;
  reviewedToday: number;
}

export interface MaturityDistribution {
  new: number;        // reviewCount === 0
  learning: number;   // interval < 21
  mature: number;     // interval >= 21
}

export interface ReviewLog {
  cardId: string;
  rating: Rating;
  timestamp: string;    // ISO datetime, e.g. "2026-05-08T14:30:00"
  elapsed: number;      // milliseconds from card display to rating click
  /**
   * Card's `due` value at the moment the rating was recorded (i.e. the due
   * BEFORE schedule() ran for this rating). Used by metrics that need to
   * reconstruct whether the review happened early/on-time/overdue
   * (e.g. proactiveReview). Optional — absent on logs predating this field.
   */
  dueAtReview?: string;
}

export interface PluginData {
  version: number;
  settings: GrindstoneSettings;
  cards: Record<string, CardData>;
  reviewLogs: ReviewLog[];
  /** Active-review session log. Strictly separate from reviewLogs. */
  cramSessions: CramSession[];
  /**
   * License layer (Pro entitlements). Optional — absent on free installs and on
   * any data.json predating the paywall. Plugin data, not user notes: lives in
   * the plugin's data.json, never written to the vault (vault read-only, spec §12).
   */
  license?: LicenseData;
}

export interface GrindstoneSettings {
  triggerTags: string[];
  excludeTags: string[];
  archiveTags: string[];
  prefixMatch: boolean;
  writeStarsBack: boolean;
  /**
   * Vault-level tag rename via Tags tab right-click. When off, the menu item is
   * present but rejects with a notice — same opt-in shape as writeStarsBack /
   * embedCardIds. See src/services/tag-rename.ts for the write path.
   */
  renameTagsInVault: boolean;
  embedCardIds: boolean;
  autoShowTags: string[];
  /** Order of due cards in a review session. Default 'random'. */
  reviewOrder?: ReviewOrder;
  /** Workspace theme: 'light' | 'dark' | undefined (follow Obsidian). */
  gsTheme?: 'light' | 'dark';
  /** Whether the sidebar rail is collapsed to icon-only mode. */
  gsSidebarCollapsed?: boolean;
  /** SRS algorithm parameters. Falls back to DEFAULT_SRS_PARAMS when absent. */
  srsParams?: SrsParams;
  /** User-created custom presets. */
  customPresets?: SrsPreset[];
  /** Active preset ID ('sm2-default', 'anki-standard', etc. or custom). */
  activePresetId?: string;
  /** Intent-layer SRS config. When set, takes priority over srsParams via intentToParams(). */
  activeIntent?: SrsIntent;
  /** User-saved intent recipes (builtin: false). Builtins live in BUILTIN_INTENT_RECIPES. */
  userIntentRecipes?: IntentRecipe[];
  /** Mixed display order of recipes (built-in + user) by id. Unlisted ids fall back to natural order at the tail. */
  recipeOrder?: string[];
  /** Built-in recipe ids the user has "deleted" — hidden from the list until reset. */
  hiddenBuiltinRecipes?: string[];
  /** Recipe id that decks without their own override use. Takes priority over activeIntent in getSrsParams. */
  defaultRecipeId?: string;
  /** Per-deck SRS strategy overrides. Key = top-level tag. Value = preset ID or custom SrsParams. */
  deckSrsOverrides?: Record<string, string | SrsParams>;
  /**
   * Strict streak mode. When true, missing a day resets streak to 0 (old behavior).
   * When false/undefined (default), the freeze system kicks in: Mondays grant +1
   * freeze (cap 2), and gaps after the last review auto-consume one freeze per day.
   */
  strictStreakMode?: boolean;
  /** Current bank of streak freezes (capped at FREEZE_CAP). */
  streakFreezes?: number;
  /** Dates (YYYY-MM-DD) where a freeze was auto-consumed to bridge a gap. */
  freezeUsedDates?: string[];
  /** Most recent Monday for which a weekly freeze grant has been recorded. */
  lastFreezeGrantDate?: string;
  /** One-time migration flag: Anki Standard step1/step2 swap fix. */
  _ankiStepFix?: boolean;
  /** First-run onboarding completed (or auto-marked for upgrading users). */
  _onboardingDone?: boolean;
  /** Custom slogans for Overview header. Empty / undefined → built-in defaults. */
  customSlogans?: string[];
  /**
   * UI language. Undefined = use `navigator.language` (ZH locale → 'zh', else 'en').
   * Persisted only after the user explicitly picks one (in Settings or onboarding).
   */
  language?: 'zh' | 'en';
  /**
   * End-of-day cutoff hour (0|1|2). Reviews before this hour count toward the
   * previous day. Default 0 (calendar midnight).
   */
  dayEndHour?: 0 | 1 | 2;
  /**
   * Capability-radar tab config. Stores the user's selected dimension keys (in
   * axis order). The metric registry lives outside settings — only the chosen
   * key list persists. Unknown / removed keys are filtered at read time.
   */
  radarConfig?: { dimensions: string[] };
  /**
   * User-saved custom decks (filter-spec presets). Tags tab pill row reads
   * this list; new cards that match a deck's filter join automatically.
   */
  customDecks?: CustomDeck[];
  /** Tags tab sidebar: whether the "卡组" group is collapsed. */
  tagsSidebarDecksCollapsed?: boolean;
  /** Tags tab sidebar: whether the "标签树" group is collapsed. */
  tagsSidebarTagTreeCollapsed?: boolean;
}

export type DeckResetMode = 'gradual' | 'reset-ease' | 'full-reset';

export type ReviewOrder = 'random' | 'due-date' | 'as-added';

// Vault-read-only by default. The two note-modifying features (embedCardIds,
// writeStarsBack) start OFF and are opt-in via the onboarding modal or Settings.
export const DEFAULT_SETTINGS: GrindstoneSettings = {
  triggerTags: ['#grind'],
  excludeTags: [],
  archiveTags: ['#archived'],
  prefixMatch: true,
  writeStarsBack: false,
  renameTagsInVault: false,
  embedCardIds: false,
  autoShowTags: [],
  reviewOrder: 'random',
};

export const DEFAULT_DATA: PluginData = {
  version: 2,
  settings: { ...DEFAULT_SETTINGS },
  cards: {},
  reviewLogs: [],
  cramSessions: [],
};
