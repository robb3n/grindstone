import { CardState, Rating, SrsParams } from '../card/types';
import { schedule } from '../srs/sm2';
import { t, StringKey } from '../i18n';

interface SimPoint {
  review: number;
  interval: number;
  ease: number;
}

function simulate(params: SrsParams, ratings: Rating[], count: number): SimPoint[] {
  let state: CardState = { interval: 0, ease: params.initialEase, reviewCount: 0 };
  const points: SimPoint[] = [];
  for (let i = 0; i < count; i++) {
    const rating = ratings[i % ratings.length];
    state = schedule(state, rating, params);
    points.push({ review: i + 1, interval: state.interval, ease: state.ease });
  }
  return points;
}

const SERIES: { labelKey: StringKey; ratings: Rating[]; color: string }[] = [
  { labelKey: 'srs.scenario.all_good',    ratings: ['good'],                                                                       color: 'var(--gs-green, #1f4d3a)' },
  { labelKey: 'srs.scenario.all_easy',    ratings: ['easy'],                                                                       color: 'var(--gs-green-2, #6fa68b)' },
  { labelKey: 'srs.scenario.alternating', ratings: ['good', 'hard'],                                                               color: 'var(--gs-gold, #b8956a)' },
  { labelKey: 'srs.scenario.recovery',    ratings: ['again', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good', 'good'], color: 'var(--gs-clay, #b83420)' },
];

const STEPS = 6;

export function renderSrsVisualization(container: HTMLElement, params: SrsParams): void {
  container.empty();
  container.addClass('gs-srs-viz');

  // Simulate all series
  const allSeries = SERIES.map(s => ({
    ...s,
    points: simulate(params, s.ratings, STEPS),
  }));

  // Chart dimensions
  const W = 480, H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 48 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  const maxInterval = Math.max(10, ...allSeries.flatMap(s => s.points.map(p => p.interval)));
  // log y-axis: early intervals (1d / 6d / 15d) get visual room instead of being
  // crushed against the baseline by a multi-year max. Use log10(x+1) so x=0 maps to 0.
  const logMax = Math.log10(maxInterval + 1);

  const xScale = (review: number) => PAD.left + ((review - 1) / (STEPS - 1)) * cw;
  const yScale = (interval: number) => PAD.top + ch - (Math.log10(Math.max(0, interval) + 1) / logMax) * ch;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'gs-srs-chart');
  svg.style.width = '100%';
  svg.style.maxWidth = `${W}px`;

  // Grid lines at decade boundaries (0, 1, 10, 100, 1000, ...) — matches log scale.
  const gridTicks: number[] = [0];
  for (let v = 1; v <= maxInterval; v *= 10) gridTicks.push(v);
  for (const val of gridTicks) {
    const y = yScale(val);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(PAD.left));
    line.setAttribute('x2', String(W - PAD.right));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'var(--gs-line, #e0ddd6)');
    line.setAttribute('stroke-width', '0.5');
    svg.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(PAD.left - 6));
    label.setAttribute('y', String(y + 4));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'gs-srs-chart-label');
    label.textContent = `${val}d`;
    svg.appendChild(label);
  }

  // X-axis labels
  for (let i = 0; i < STEPS; i++) {
    const x = xScale(i + 1);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(H - 6));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'gs-srs-chart-label');
    label.textContent = String(i + 1);
    svg.appendChild(label);
  }

  // Lines + dots
  for (const series of allSeries) {
    const pathParts = series.points.map((p, i) => {
      const x = xScale(p.review);
      const y = yScale(p.interval);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    });

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathParts.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', series.color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    for (const p of series.points) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(xScale(p.review)));
      circle.setAttribute('cy', String(yScale(p.interval)));
      circle.setAttribute('r', '3');
      circle.setAttribute('fill', series.color);
      svg.appendChild(circle);
    }
  }

  container.appendChild(svg);

  // Legend
  const legend = container.createDiv({ cls: 'gs-srs-legend' });
  for (const s of allSeries) {
    const item = legend.createDiv({ cls: 'gs-srs-legend-item' });
    const dot = item.createSpan({ cls: 'gs-srs-legend-dot' });
    dot.style.background = s.color;
    item.createSpan({ text: t(s.labelKey) });
  }

  // Key callouts
  const callouts = container.createDiv({ cls: 'gs-srs-callouts' });
  const goodSeries = allSeries[0].points;
  const easySeries = allSeries[1].points;

  const addCallout = (label: string, value: string) => {
    const c = callouts.createDiv({ cls: 'gs-srs-callout' });
    c.createSpan({ cls: 'gs-srs-callout-val gs-mono', text: value });
    c.createSpan({ cls: 'gs-srs-callout-label', text: label });
  };

  addCallout(t('srs.callout.good5'), t('srs.callout.days', { n: goodSeries[4]?.interval ?? 0 }));
  addCallout(t('srs.callout.good6'), t('srs.callout.days', { n: goodSeries[5]?.interval ?? 0 }));
  addCallout(t('srs.callout.easy5'), t('srs.callout.days', { n: easySeries[4]?.interval ?? 0 }));

  // Again recovery: how many Good reviews to recover to baseline from Again
  const againSeries = allSeries[3].points;
  const baseline = goodSeries[0]?.interval ?? 1;
  const recoveryIdx = againSeries.findIndex((p, i) => i > 0 && p.interval >= baseline);
  const recoveryLabel = recoveryIdx > 0 ? t('srs.callout.recovery_n', { n: recoveryIdx }) : '—';
  addCallout(t('srs.callout.recovery'), recoveryLabel);
}
