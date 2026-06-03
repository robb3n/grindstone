import { CardState, Rating, SrsParams, DEFAULT_SRS_PARAMS } from '../card/types';

/**
 * SM-2 scheduling – pure function.
 * Returns a new CardState with updated interval, ease, and reviewCount.
 */
export function schedule(
  state: CardState,
  rating: Rating,
  params: SrsParams = DEFAULT_SRS_PARAMS,
): CardState {
  const reviewCount = state.reviewCount + 1;
  let ease = state.ease;
  let interval: number;
  // Global interval scaling (goal=sprint < 1, longterm = 1). Absent on legacy /
  // default params → 1, so their behavior is unchanged. Applied only to the
  // good/easy multiplicative path; hard is already goal-scaled via hardMultiplier.
  const mod = params.intervalModifier ?? 1;

  switch (rating) {
    case 'again':
      ease = Math.max(params.minEase, state.ease - params.againPenalty);
      interval = params.againInterval;
      break;

    case 'easy':
      ease = state.ease + params.easeBonus;
      if (reviewCount <= 1) {
        interval = params.easyInterval;
      } else if (reviewCount === 2) {
        interval = params.step2Interval;
      } else {
        // Floor to graduatingInterval: after a lapse `interval` is 0, and
        // round(0 * ease) === 0 would trap the card at due-today forever
        // (only Hard could escape). Re-graduate instead of multiplying zero.
        interval = Math.max(params.graduatingInterval, Math.round(state.interval * ease * mod));
      }
      break;

    case 'good':
      ease = state.ease + params.easeGoodDelta;
      if (reviewCount <= 1) {
        interval = params.graduatingInterval;
      } else if (reviewCount === 2) {
        interval = params.step1Interval;
      } else {
        // Same lapse guard as 'easy' — floor prevents round(0 * ease) = 0
        // trapping a lapsed card at due-today.
        interval = Math.max(params.graduatingInterval, Math.round(state.interval * ease * mod));
      }
      break;

    case 'hard':
      ease = Math.max(params.minEase, state.ease - params.easeHardPenalty);
      if (reviewCount <= 1) {
        interval = params.graduatingInterval;
      } else {
        interval = Math.max(1, Math.round(state.interval * params.hardMultiplier));
      }
      break;
  }

  return { interval, ease, reviewCount };
}

export function initialCardState(params?: SrsParams): CardState {
  return { interval: 0, ease: (params ?? DEFAULT_SRS_PARAMS).initialEase, reviewCount: 0 };
}
