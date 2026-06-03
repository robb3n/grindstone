import {
  SrsIntent, SrsParams,
  IntentIntensity, IntentTolerance, IntentStart, IntentGoal,
} from '../card/types';

interface ToleranceMap { minEase: number; easeHardPenalty: number; againPenalty: number; easeGoodDelta: number; }
interface StartMap     { graduatingInterval: number; step1Interval: number; step2Interval: number; easyInterval: number; againInterval: number; }
interface GoalMap      { easeBonus: number; hardMultiplier: number; intervalModifier: number; }

const TOLERANCE: Record<IntentTolerance, ToleranceMap> = {
  strict:  { minEase: 1.25, easeHardPenalty: 0.20, againPenalty: 0.30, easeGoodDelta: 0    },
  std:     { minEase: 1.30, easeHardPenalty: 0.15, againPenalty: 0.20, easeGoodDelta: 0    },
  lenient: { minEase: 1.40, easeHardPenalty: 0.10, againPenalty: 0.15, easeGoodDelta: 0.05 },
};

const START: Record<IntentStart, StartMap> = {
  dense:  { graduatingInterval: 1, step1Interval: 2, step2Interval: 4,  easyInterval: 3, againInterval: 0 },
  std:    { graduatingInterval: 1, step1Interval: 3, step2Interval: 6,  easyInterval: 4, againInterval: 0 },
  spaced: { graduatingInterval: 3, step1Interval: 7, step2Interval: 14, easyInterval: 6, againInterval: 1 },
};

const GOAL: Record<IntentGoal, GoalMap> = {
  // intervalModifier scales the good/easy multiplicative path. longterm is the
  // 1.0 anchor (= legacy/default behavior, no migration surprise); sprint pulls
  // intervals ~15% shorter so "短期冲刺 vs 长期保持" actually diverges on the
  // most common (all-good) trajectory, not just on easy/hard.
  sprint:   { easeBonus: 0.10, hardMultiplier: 1.10, intervalModifier: 0.85 },
  longterm: { easeBonus: 0.20, hardMultiplier: 1.20, intervalModifier: 1.00 },
};

function intensityToInitialEase(i: IntentIntensity): number {
  return 2.0 + (5 - i) * 0.2;
}

function clampNonNegative(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function clampInterval(n: number, fallback: number): number {
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export function intentToParams(intent: SrsIntent): SrsParams {
  const tol  = TOLERANCE[intent.tolerance];
  const stt  = START[intent.start];
  const goal = GOAL[intent.goal];
  const initialEase = intensityToInitialEase(intent.intensity);

  return {
    initialEase:        clampNonNegative(initialEase,        2.5),
    minEase:            clampNonNegative(tol.minEase,        1.3),
    easeBonus:          clampNonNegative(goal.easeBonus,     0.15),
    easeGoodDelta:      clampNonNegative(tol.easeGoodDelta,  0),
    easeHardPenalty:    clampNonNegative(tol.easeHardPenalty, 0.15),
    againPenalty:       clampNonNegative(tol.againPenalty,   0.20),
    hardMultiplier:     clampNonNegative(goal.hardMultiplier, 1.2),
    intervalModifier:   clampNonNegative(goal.intervalModifier, 1),
    graduatingInterval: clampInterval(stt.graduatingInterval, 1),
    easyInterval:       clampInterval(stt.easyInterval,       4),
    againInterval:      clampInterval(stt.againInterval,      0),
    step1Interval:      clampInterval(stt.step1Interval,      3),
    step2Interval:      clampInterval(stt.step2Interval,      6),
  };
}
