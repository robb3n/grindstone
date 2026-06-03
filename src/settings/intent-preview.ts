import { SrsIntent, SrsParams, CardState, Rating } from '../card/types';
import { intentToParams } from '../srs/intent';
import { schedule } from '../srs/sm2';
import { t, getLang, StringKey } from '../i18n';

export interface IntentPreviewOptions {
  intent?: SrsIntent;
  params?: SrsParams;
}

export interface IntentPreviewHandle {
  update(opts: IntentPreviewOptions): void;
  detach(): void;
}

const RATING_COLOR: Record<'again' | 'hard' | 'good' | 'easy', string> = {
  again: 'var(--gs-clay, #b8533a)',
  hard:  'var(--gs-gold, #b8956a)',
  good:  'var(--gs-green, #1f4d3a)',
  easy:  'var(--gs-green-2, #6fa68b)',
};

function fmtDays(d: number, isZh: boolean): string {
  if (!Number.isFinite(d) || d < 1) return isZh ? '今天' : 'Today';
  const r = Math.round(d);
  if (isZh) {
    if (r === 1) return '明天';
    if (r === 2) return '后天';
    if (r < 7) return `${r} 天后`;
    if (r === 7) return '1 周后';
    if (r < 14) return `${r} 天后`;
    if (r === 14) return '2 周后';
    if (r === 21) return '3 周后';
    if (r < 30) return `${Math.round(r / 7)} 周后`;
    if (r < 45) return '1 个月后';
    if (r < 75) return `${Math.round(r / 30)} 个月后`;
    if (r < 105) return '约 3 个月后';
    if (r < 150) return `${Math.round(r / 30)} 个月后`;
    if (r < 220) return '半年后';
    if (r < 320) return `${Math.round(r / 30)} 个月后`;
    if (r < 450) return '1 年后';
    if (r < 660) return '1 年半后';
    return `${(r / 365).toFixed(1)} 年后`;
  }
  if (r === 1) return 'Tomorrow';
  if (r < 7) return `${r} days`;
  if (r === 7) return '1 week';
  if (r < 14) return `${r} days`;
  if (r === 14) return '2 weeks';
  if (r === 21) return '3 weeks';
  if (r < 30) return `${Math.round(r / 7)} weeks`;
  if (r < 45) return '1 month';
  if (r < 105) return `${Math.round(r / 30)} months`;
  if (r < 220) return `${Math.round(r / 30)} months`;
  if (r < 450) return '1 year';
  if (r < 660) return '1.5 years';
  return `${(r / 365).toFixed(1)} years`;
}

function resolveParams(opts: IntentPreviewOptions): { params: SrsParams; tolerance?: 'strict' | 'std' | 'lenient' } {
  if (opts.params) return { params: opts.params, tolerance: opts.intent?.tolerance };
  if (opts.intent) return { params: intentToParams(opts.intent), tolerance: opts.intent.tolerance };
  throw new Error('renderIntentPreview: must provide intent or params');
}

/**
 * A card that's been recalled a few times — past the learning steps and into the
 * multiplicative regime (round(interval * ease)). The rating buttons are sampled
 * HERE, not on a just-graduated card, because intensity (ease) and goal
 * (easeBonus / hardMultiplier) only bite once intervals multiply. Sampling at
 * review #2 made those two whole dimensions invisible on the cards.
 */
function seedMatureCard(params: SrsParams): CardState {
  let state: CardState = { interval: 0, ease: params.initialEase, reviewCount: 0 };
  for (let i = 0; i < 3; i++) state = schedule(state, 'good', params);
  return state;
}

export function renderIntentPreview(container: HTMLElement, initial: IntentPreviewOptions): IntentPreviewHandle {
  const isZh = getLang() === 'zh';
  let current: IntentPreviewOptions = initial;
  let projRating: 'hard' | 'good' | 'easy' = 'good';

  container.empty();
  container.addClass('gs-intent-preview');

  container.createDiv({ cls: 'gs-intent-preview-title', text: t('settings.srs.preview.title') });
  container.createDiv({ cls: 'gs-intent-preview-sub', text: t('settings.srs.preview.sub') });

  // 4 rating buttons
  const ratingRow = container.createDiv({ cls: 'gs-rating-row' });
  const whenEls: Record<'again' | 'hard' | 'good' | 'easy', HTMLElement> = {} as Record<'again' | 'hard' | 'good' | 'easy', HTMLElement>;
  for (const r of ['again', 'hard', 'good', 'easy'] as const) {
    const card = ratingRow.createDiv({ cls: `gs-rb gs-rb-${r}` });
    card.createSpan({ cls: 'gs-rb-pill', text: t(`settings.srs.rating.${r}` as StringKey) });
    card.createSpan({ cls: 'gs-rb-when-lbl', text: t('settings.srs.rating.when_label') });
    whenEls[r] = card.createSpan({ cls: 'gs-rb-when' });
    card.createSpan({ cls: 'gs-rb-desc', text: t(`settings.srs.rating.${r}.desc` as StringKey) });
  }

  // Projection
  const projWrap = container.createDiv({ cls: 'gs-proj' });
  projWrap.createDiv({ cls: 'gs-proj-title', text: t('settings.srs.proj.title') });
  projWrap.createDiv({ cls: 'gs-proj-sub', text: t('settings.srs.proj.sub') });

  const projTabsWrap = projWrap.createDiv({ cls: 'gs-proj-tabs' });
  const projBtns: Record<'hard' | 'good' | 'easy', HTMLButtonElement> = {} as Record<'hard' | 'good' | 'easy', HTMLButtonElement>;
  for (const r of ['hard', 'good', 'easy'] as const) {
    const btn = projTabsWrap.createEl('button', { cls: 'gs-proj-tab', text: t(`settings.srs.rating.${r}` as StringKey) });
    btn.addEventListener('click', () => { projRating = r; render(); });
    projBtns[r] = btn;
  }

  const timeline = projWrap.createDiv({ cls: 'gs-proj-timeline' });
  timeline.createDiv({ cls: 'gs-proj-track' });
  const trackFill = timeline.createDiv({ cls: 'gs-proj-trackfill' });
  const nodesEl = timeline.createDiv({ cls: 'gs-proj-nodes' });

  // Per-rating rhythm caption — also reframes Hard's flat "明天×6" line (real, not
  // a bug: an always-hard card stays on a short leash) as intentional firefighting.
  const projNote = projWrap.createDiv({ cls: 'gs-proj-note' });

  // ── Lapse & recovery — the ONLY place the tolerance dimension becomes visible.
  // The cards and projection above never fail, so strict/std/lenient look identical
  // there; here one slip + the climb-back separates the three notches.
  const lapseWrap = container.createDiv({ cls: 'gs-lapse' });
  lapseWrap.createDiv({ cls: 'gs-lapse-title', text: t('settings.srs.lapse.title') });
  lapseWrap.createDiv({ cls: 'gs-lapse-sub', text: t('settings.srs.lapse.sub') });
  const lapseTimeline = lapseWrap.createDiv({ cls: 'gs-proj-timeline' });
  lapseTimeline.createDiv({ cls: 'gs-proj-track' });
  const lapseFill = lapseTimeline.createDiv({ cls: 'gs-proj-trackfill' });
  const lapseNodesEl = lapseTimeline.createDiv({ cls: 'gs-proj-nodes' });
  const lapseNote = lapseWrap.createDiv({ cls: 'gs-proj-note' });

  container.createDiv({ cls: 'gs-intent-foot', text: t('settings.srs.foot') });

  function computeButtonTimes(): Record<'again' | 'hard' | 'good' | 'easy', string> {
    const { params, tolerance } = resolveParams(current);
    const base = seedMatureCard(params);
    const after = (rating: Rating): number => schedule(base, rating, params).interval;
    const againIv = after('again');
    // againInterval >= 1 day → show the real day count (spaced re-shows tomorrow,
    // not "in minutes" — the old hardcoded gloss lied here). When it's 0 the engine
    // has no sub-day steps, so gloss as a short re-drill: strict drills soonest.
    const againMin = tolerance === 'strict' ? 10 : tolerance === 'lenient' ? 30 : 15;
    return {
      again: againIv >= 1 ? fmtDays(againIv, isZh) : (isZh ? `${againMin} 分钟后` : `${againMin} min`),
      hard:  fmtDays(after('hard'), isZh),
      good:  fmtDays(after('good'), isZh),
      easy:  fmtDays(after('easy'), isZh),
    };
  }

  function computeProjection(rating: 'hard' | 'good' | 'easy'): string[] {
    const { params } = resolveParams(current);
    let state: CardState = { interval: 0, ease: params.initialEase, reviewCount: 0 };
    const nodes = [t('settings.srs.proj.step_now')];
    for (let i = 0; i < 6; i++) {
      state = schedule(state, rating, params);
      nodes.push(fmtDays(state.interval, isZh));
    }
    return nodes;
  }

  // A stable mature card → one slip (Again) → the good-only climb back. The slip's
  // ease drop is governed by tolerance (againPenalty / minEase), so this track is
  // where strict / std / lenient pull apart — lenient climbs back fastest.
  function computeRecovery(): { num: string; when: string; color: string }[] {
    const { params } = resolveParams(current);
    const pre = seedMatureCard(params);
    const green = RATING_COLOR.good;
    const clay = RATING_COLOR.again;
    const nodes = [
      { num: t('settings.srs.lapse.stable'), when: fmtDays(pre.interval, isZh), color: green },
      { num: t('settings.srs.rating.again'), when: t('settings.srs.lapse.relearn'), color: clay },
    ];
    let state = schedule(pre, 'again', params);
    for (let i = 0; i < 5; i++) {
      state = schedule(state, 'good', params);
      nodes.push({ num: t('settings.srs.proj.step_n', { n: i + 1 }), when: fmtDays(state.interval, isZh), color: green });
    }
    return nodes;
  }

  function render(): void {
    const bt = computeButtonTimes();
    whenEls.again.textContent = bt.again;
    whenEls.hard.textContent  = bt.hard;
    whenEls.good.textContent  = bt.good;
    whenEls.easy.textContent  = bt.easy;

    const color = RATING_COLOR[projRating];
    const data = computeProjection(projRating);
    nodesEl.empty();
    data.forEach((label, i) => {
      const node = nodesEl.createDiv({ cls: 'gs-proj-node' });
      const numText = i === 0
        ? t('settings.srs.proj.step_now')
        : t('settings.srs.proj.step_n', { n: i });
      node.createDiv({ cls: 'gs-proj-num', text: numText });
      const ball = node.createDiv({ cls: 'gs-proj-ball' });
      if (i > 0) {
        ball.style.background = color;
        ball.style.boxShadow = `0 0 0 2px ${color}`;
      }
      node.createDiv({ cls: 'gs-proj-when', text: label });
    });
    trackFill.style.background = color;
    projNote.textContent = t(`settings.srs.proj.note.${projRating}` as StringKey);
    projNote.style.borderLeftColor = color;
    requestAnimationFrame(() => {
      const w = nodesEl.offsetWidth;
      trackFill.style.width = (w - w / data.length) + 'px';
    });

    renderLapse();

    for (const r of ['hard', 'good', 'easy'] as const) {
      const on = projRating === r;
      const btn = projBtns[r];
      btn.toggleClass('on', on);
      btn.style.background = on ? RATING_COLOR[r] : '';
      btn.style.borderColor = on ? RATING_COLOR[r] : '';
      btn.style.color = on ? '#fff' : '';
    }
  }

  function renderLapse(): void {
    const nodes = computeRecovery();
    lapseNodesEl.empty();
    nodes.forEach((n) => {
      const node = lapseNodesEl.createDiv({ cls: 'gs-proj-node' });
      node.createDiv({ cls: 'gs-proj-num', text: n.num });
      const ball = node.createDiv({ cls: 'gs-proj-ball' });
      ball.style.background = n.color;
      ball.style.boxShadow = `0 0 0 2px ${n.color}`;
      node.createDiv({ cls: 'gs-proj-when', text: n.when });
    });

    const { tolerance } = resolveParams(current);
    const noteKey = tolerance ? `settings.srs.lapse.note.${tolerance}` : 'settings.srs.lapse.note.generic';
    lapseNote.textContent = t(noteKey as StringKey);
    lapseNote.style.borderLeftColor = RATING_COLOR.again;
    lapseFill.style.background = 'var(--background-modifier-border)';
    requestAnimationFrame(() => {
      const w = lapseNodesEl.offsetWidth;
      lapseFill.style.width = (w - w / nodes.length) + 'px';
    });
  }

  render();

  return {
    update(opts: IntentPreviewOptions): void {
      current = opts;
      render();
    },
    detach(): void {
      container.empty();
      container.removeClass('gs-intent-preview');
    },
  };
}
