import { TabContext } from './types';
import { countUp } from '../anim';
import { t, StringKey } from '../../i18n';
import { setHtml } from '../../util/dom';

export function renderStats(container: HTMLElement, ctx: TabContext): void {
  let range = 30;
  const rangeDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, 'all': 365 };

  // ── Page Head ──
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('stats.title') });

  const headR = head.createDiv({ cls: 'gs-pagehead-r' });
  const rangeDiv = headR.createDiv({ cls: 'st-range' });

  const page = container.createDiv({ cls: 'gs-page st-page' });

  const RANGE_LABELS: Record<string, StringKey> = {
    '7d':  'stats.range.7d',
    '30d': 'stats.range.30d',
    '90d': 'stats.range.90d',
    'all': 'stats.range.all',
  };

  const renderAll = () => {
    rangeDiv.empty();
    for (const r of ['7d', '30d', '90d', 'all']) {
      const btn = rangeDiv.createEl('button', {
        cls: `st-range-btn${rangeDays[r] === range ? ' st-range-btn-on' : ''}`,
        text: t(RANGE_LABELS[r]),
      });
      btn.addEventListener('click', () => { range = rangeDays[r]; renderAll(); });
    }

    page.empty();
    const kpi = ctx.store.getStatsKPI(range);
    const trend = ctx.store.getReviewTrend(range);
    const accByTag = ctx.store.getAccuracyByTag();
    const forgetting = ctx.store.getForgettingCurve();
    const heatmap = ctx.store.get12WeekHeatmap();
    const minutes = ctx.store.getStudyMinutesTrend(range);

    // ── KPI Row ──
    const kpis = page.createDiv({ cls: 'st-kpis' });
    addKPI(kpis, t('stats.kpi.reviewed'),     kpi.reviewed,      t('stats.kpi.reviewed_unit'),                          kpi.reviewedDelta,     0);
    addKPI(kpis, t('stats.kpi.study_time'),   kpi.studyMinutes,  t('stats.kpi.study_time_unit'),                        kpi.studyMinutesDelta, 80);
    addKPI(kpis, t('stats.kpi.active_days'),  kpi.activeDays,    t('stats.kpi.active_days_unit', { days: range }),      kpi.activeDaysDelta,   160);
    addKPI(kpis, t('stats.kpi.accuracy'),     kpi.accuracy,      t('stats.kpi.accuracy_unit'),                          kpi.accuracyDelta,     240);

    // ── Row 1: Trend + Accuracy ──
    const row1 = page.createDiv({ cls: 'st-row st-row-2-1' });
    renderTrendCard(row1, trend);
    renderAccuracyCard(row1, accByTag);

    // ── Row 2: Forgetting + Heatmap + Minutes ──
    const row2 = page.createDiv({ cls: 'st-row st-row-3' });
    renderForgetCard(row2, forgetting);
    renderHeatmapCard(row2, heatmap);
    renderMinutesCard(row2, minutes);

    // ── Cram (active-review) section — appended at end, strictly isolated ──
    renderCramSection(page, ctx);
  };

  renderAll();
}

/** Cram-only stats. Data path is fully separate from SRS reviewLogs/cards. */
function renderCramSection(parent: HTMLElement, ctx: TabContext): void {
  const sessions = ctx.store.getCramSessions();
  const cards = ctx.store.getAllCardsMap();

  const card = parent.createDiv({ cls: 'st-card gs-card gs-hoverable st-cram-card' });
  const head = card.createDiv({ cls: 'st-card-head' });
  const headL = head.createDiv({ cls: 'st-card-head-l' });
  headL.createDiv({ cls: 'st-card-zh', text: t('stats.cram.title') });
  headL.createDiv({ cls: 'st-card-sub', text: t('stats.cram.sub') });

  const body = card.createDiv({ cls: 'st-card-body st-cram-body' });

  if (sessions.length === 0) {
    body.createDiv({ cls: 'st-cram-empty', text: t('stats.cram.empty') });
    return;
  }

  // KPI row
  const now = Date.now();
  const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const monthCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const weekSessions = sessions.filter(s => s.startedAt >= weekCutoff).length;
  const monthSessions = sessions.filter(s => s.startedAt >= monthCutoff).length;
  const totalRates = Object.values(cards).reduce((sum, c) => sum + (c.cram?.count ?? 0), 0);
  const coveredCount = Object.values(cards).filter(c => (c.cram?.count ?? 0) > 0).length;
  const totalCards = Object.values(cards).filter(c => !c.disabled).length;

  const kpiRow = body.createDiv({ cls: 'st-cram-kpis' });
  const addCramKpi = (label: string, value: string) => {
    const k = kpiRow.createDiv({ cls: 'st-cram-kpi' });
    k.createDiv({ cls: 'st-cram-kpi-label', text: label });
    k.createDiv({ cls: 'st-cram-kpi-value gs-mono', text: value });
  };
  addCramKpi(t('stats.cram.week_sessions'),  String(weekSessions));
  addCramKpi(t('stats.cram.month_sessions'), String(monthSessions));
  addCramKpi(t('stats.cram.total_rates'),    String(totalRates));
  addCramKpi(t('stats.cram.coverage'),       t('stats.cram.coverage_unit', { covered: coveredCount, total: totalCards }));

  // Recent 5 sessions
  const recentLabel = body.createDiv({ cls: 'st-cram-recent-label', text: t('stats.cram.recent') });
  recentLabel.style.marginTop = '12px';
  const recent = [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
  const recentList = body.createDiv({ cls: 'st-cram-recent-list' });
  for (const s of recent) {
    const row = recentList.createDiv({ cls: 'st-cram-recent-row' });
    const date = new Date(s.startedAt).toISOString().slice(0, 16).replace('T', ' ');
    const min = Math.max(1, Math.round(s.durationMs / 60000));
    row.textContent = t('stats.cram.recent_row', {
      date,
      unique: s.uniqueCards,
      again: s.againCount,
      min,
    });
  }

  // Most-cemented tag (cards with highest cram.count, aggregated by top-level tag)
  const tagCounts = new Map<string, number>();
  for (const c of Object.values(cards)) {
    if (!c.cram || c.cram.count === 0) continue;
    for (const tag of c.tags) {
      const top = tag.split('/')[0];
      tagCounts.set(top, (tagCounts.get(top) ?? 0) + c.cram.count);
    }
  }
  if (tagCounts.size > 0) {
    let topTag = '';
    let topCount = 0;
    for (const [tg, n] of tagCounts) {
      if (n > topCount) { topCount = n; topTag = tg; }
    }
    if (topTag) {
      const tt = body.createDiv({ cls: 'st-cram-top-tag' });
      tt.createSpan({ cls: 'st-cram-top-tag-label', text: t('stats.cram.top_tag') + '：' });
      tt.createSpan({ cls: 'st-cram-top-tag-value gs-mono', text: `${topTag} · ${topCount}` });
    }
  }
}


function addKPI(parent: HTMLElement, label: string, value: number, unit: string, delta: number | null, delay: number): void {
  const tile = parent.createDiv({ cls: 'st-kpi gs-card gs-hoverable gs-rise' });
  tile.style.animationDelay = `${delay}ms`;
  tile.createDiv({ cls: 'st-kpi-zh', text: label });
  const num = tile.createDiv({ cls: 'st-kpi-num gs-mono' });
  const valSpan = num.createSpan();
  countUp(valSpan, value, 900, delay, (n) => n.toLocaleString());
  if (unit) num.createSpan({ cls: 'st-kpi-unit', text: unit });

  if (delta !== null) {
    const trend = delta >= 0 ? 'up' : 'down';
    const deltaEl = tile.createDiv({ cls: `st-kpi-delta st-kpi-delta-${trend}` });
    setHtml(deltaEl, `<svg width="10" height="10" viewBox="0 0 10 10"><path d="${trend === 'up' ? 'M2 7l3-3 3 3' : 'M2 3l3 3 3-3'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    deltaEl.appendText(delta >= 0 ? `+${delta}%` : `${delta}%`);
  }
}

/** Simple bucket-average downsample for large datasets. */
function downsample(data: number[], targetPoints: number): number[] {
  if (data.length <= targetPoints) return data;
  const bucketSize = data.length / targetPoints;
  const result: number[] = [];
  for (let i = 0; i < targetPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j];
    result.push(Math.round(sum / (end - start)));
  }
  return result;
}

function statCardHead(parent: HTMLElement, title: string): HTMLElement {
  const card = parent.createDiv({ cls: 'st-card gs-card gs-hoverable' });
  const head = card.createDiv({ cls: 'st-card-head' });
  const headL = head.createDiv({ cls: 'st-card-head-l' });
  headL.createDiv({ cls: 'st-card-zh', text: title });
  return card;
}

function renderTrendCard(parent: HTMLElement, data: Array<{ date: string; count: number }>): void {
  const card = statCardHead(parent, t('stats.card.trend'));

  const body = card.createDiv({ cls: 'st-card-body st-chart' });
  const W = 720, H = 200, P = { l: 32, r: 16, t: 16, b: 24 };
  const rawValues = data.map(d => d.count);
  const values = downsample(rawValues, 200);
  const max = Math.max(...values, 1);
  const xs = values.map((_, i) => P.l + (i / Math.max(1, values.length - 1)) * (W - P.l - P.r));
  const ys = values.map(v => P.t + (1 - v / max) * (H - P.t - P.b));
  const points = xs.map((x, i) => `${x},${ys[i]}`).join(' ');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.width = '100%';
  svg.style.height = '200px';

  // Grid lines
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    const y = P.t + g * (H - P.t - P.b);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(P.l)); line.setAttribute('x2', String(W - P.r));
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'var(--gs-line)'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  }

  // Area
  if (values.length > 1) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.id = 'st-trend-grad';
    grad.setAttribute('x1', '0'); grad.setAttribute('x2', '0'); grad.setAttribute('y1', '0'); grad.setAttribute('y2', '1');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', 'var(--gs-green)'); s1.setAttribute('stop-opacity', '0.22');
    const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', 'var(--gs-green)'); s2.setAttribute('stop-opacity', '0');
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', `M${xs[0]},${H - P.b} L${points.replace(/ /g, ' L')} L${xs[xs.length - 1]},${H - P.b} Z`);
    area.setAttribute('fill', 'url(#st-trend-grad)');
    area.style.opacity = '0';
    area.style.transition = 'opacity .6s ease-out .4s';
    svg.appendChild(area);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', 'M' + points.replace(/ /g, ' L'));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'var(--gs-green)');
    line.setAttribute('stroke-width', '1.8'); line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    window.setTimeout(() => {
      if (!line.isConnected) return;
      const len = line.getTotalLength();
      line.style.strokeDasharray = `${len}`;
      line.style.strokeDashoffset = `${len}`;
      line.getBoundingClientRect();
      line.style.transition = 'stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1)';
      line.style.strokeDashoffset = '0';
      area.style.opacity = '1';
    }, 16);
  }

  // Dots
  const dots: SVGCircleElement[] = [];
  for (let i = 0; i < values.length; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(xs[i])); c.setAttribute('cy', String(ys[i]));
    c.setAttribute('r', '2.4'); c.setAttribute('fill', 'var(--gs-green)');
    c.style.opacity = '0';
    c.style.transition = 'opacity .25s ease-out';
    svg.appendChild(c);
    dots.push(c);
  }
  const dotStep = Math.max(8, 900 / Math.max(1, dots.length));
  dots.forEach((c, i) => {
    window.setTimeout(() => {
      if (c.isConnected) c.style.opacity = '1';
    }, 50 + i * dotStep);
  });

  body.appendChild(svg);
}

function renderAccuracyCard(parent: HTMLElement, data: Array<{ tag: string; accuracy: number; reviewCount: number }>): void {
  const card = statCardHead(parent, t('stats.card.accuracy'));

  const body = card.createDiv({ cls: 'st-card-body st-acc' });
  const sorted = [...data].sort((a, b) => b.accuracy - a.accuracy).slice(0, 10);

  sorted.forEach((t, i) => {
    const tone = t.accuracy >= 85 ? 'green' : t.accuracy >= 70 ? 'gold' : 'clay';
    const parts = t.tag.split('/');
    const leaf = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join(' / ');

    const row = body.createDiv({ cls: 'st-acc-row' });
    const label = row.createDiv({ cls: 'st-acc-l' });
    label.createDiv({ cls: 'st-acc-leaf', text: leaf });
    if (parentPath) label.createDiv({ cls: 'st-acc-parent', text: parentPath });

    const barWrap = row.createDiv({ cls: 'st-acc-bar-wrap' });
    const bar = barWrap.createDiv({ cls: `st-acc-bar st-acc-bar-${tone}` });
    bar.style.width = '0%';
    window.setTimeout(() => {
      if (bar.isConnected) bar.style.width = `${t.accuracy}%`;
    }, i * 60 + 40);

    const pct = row.createDiv({ cls: `st-acc-pct gs-mono st-acc-pct-${tone}` });
    pct.textContent = String(t.accuracy);
    pct.createSpan({ text: '%' });

    row.createDiv({ cls: 'st-acc-n gs-mono', text: `n=${t.reviewCount}` });
  });
}

function renderForgetCard(parent: HTMLElement, data: Array<{ intervalDays: number; retention: number; sampleSize: number }>): void {
  const card = statCardHead(parent, t('stats.card.forget'));

  const body = card.createDiv({ cls: 'st-card-body st-chart' });

  if (data.length === 0) {
    body.createDiv({ cls: 'gs-placeholder', text: t('stats.no_data') });
    return;
  }

  const W = 320, H = 200, P = { l: 30, r: 12, t: 14, b: 24 };
  const maxD = Math.max(...data.map(p => p.intervalDays), 1);
  const xs = data.map(p => P.l + (Math.log(Math.max(1, p.intervalDays)) / Math.log(maxD)) * (W - P.l - P.r));
  const ys = data.map(p => P.t + (1 - p.retention / 100) * (H - P.t - P.b));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = '100%'; svg.style.height = '200px';

  let linePath: SVGPathElement | null = null;
  if (data.length > 1) {
    linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    linePath.setAttribute('d', 'M' + xs.map((x, i) => `${x},${ys[i]}`).join(' L'));
    linePath.setAttribute('fill', 'none'); linePath.setAttribute('stroke', 'var(--gs-clay)'); linePath.setAttribute('stroke-width', '1.8');
    svg.appendChild(linePath);
  }

  const dots: SVGCircleElement[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(xs[i])); c.setAttribute('cy', String(ys[i]));
    c.setAttribute('r', '3'); c.setAttribute('fill', 'var(--gs-card)');
    c.setAttribute('stroke', 'var(--gs-clay)'); c.setAttribute('stroke-width', '1.6');
    c.style.opacity = '0';
    c.style.transition = 'opacity .28s ease-out';
    svg.appendChild(c);
    dots.push(c);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(xs[i])); text.setAttribute('y', String(H - 6));
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '9');
    text.setAttribute('fill', 'var(--gs-ink-3)'); text.setAttribute('font-family', 'var(--gs-font-mono)');
    text.textContent = `${data[i].intervalDays}d`;
    svg.appendChild(text);
  }

  window.setTimeout(() => {
    if (linePath && linePath.isConnected) {
      const len = linePath.getTotalLength();
      linePath.style.strokeDasharray = `${len}`;
      linePath.style.strokeDashoffset = `${len}`;
      linePath.getBoundingClientRect();
      linePath.style.transition = 'stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1)';
      linePath.style.strokeDashoffset = '0';
    }
    const step = Math.max(60, 800 / Math.max(1, dots.length));
    dots.forEach((c, i) => {
      window.setTimeout(() => {
        if (c.isConnected) c.style.opacity = '1';
      }, i * step);
    });
  }, 16);

  body.appendChild(svg);

  const legend = body.createDiv({ cls: 'st-fc-legend' });
  const left = legend.createDiv();
  setHtml(left, `<span class="st-fc-dot"></span>${escapeHtml(t('stats.fc.legend'))}`);
  legend.createDiv({ cls: 'st-fc-axis', text: t('stats.fc.axis') });
}

function renderHeatmapCard(parent: HTMLElement, cells: number[]): void {
  const card = statCardHead(parent, t('stats.card.heatmap'));

  const body = card.createDiv({ cls: 'st-card-body st-chart' });
  const cols = 12, rows = 7, cell = 14, gap = 3;
  const palette = ['var(--gs-line)', 'var(--gs-green-soft)', '#9bbcaa', '#5b8d75', 'var(--gs-green)'];
  const labels = [t('stats.hm.day.mon'), '', t('stats.hm.day.wed'), '', t('stats.hm.day.fri'), '', t('stats.hm.day.sun')];
  const W = cols * (cell + gap) - gap + 16;
  const H = rows * (cell + gap) - gap + 18;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = '100%'; svg.style.height = 'auto';

  for (let r = 0; r < rows; r++) {
    if (labels[r]) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '0'); text.setAttribute('y', String(r * (cell + gap) + cell - 3));
      text.setAttribute('font-size', '8'); text.setAttribute('fill', 'var(--gs-ink-3)');
      text.textContent = labels[r];
      svg.appendChild(text);
    }
  }

  for (let i = 0; i < cells.length; i++) {
    const c = Math.floor(i / rows), r = i % rows;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(c * (cell + gap) + 14)); rect.setAttribute('y', String(r * (cell + gap)));
    rect.setAttribute('width', String(cell)); rect.setAttribute('height', String(cell));
    rect.setAttribute('rx', '2.5'); rect.setAttribute('fill', palette[Math.min(4, Math.max(0, cells[i]))]);
    rect.style.transformBox = 'fill-box';
    rect.style.transformOrigin = 'center';
    rect.style.transform = 'scale(0)';
    rect.style.opacity = '0';
    rect.style.transition = 'transform .42s cubic-bezier(.2,.7,.3,1), opacity .28s ease-out';
    svg.appendChild(rect);
    const delay = c * 32 + r * 8 + 40;
    window.setTimeout(() => {
      if (!rect.isConnected) return;
      rect.style.transform = 'scale(1)';
      rect.style.opacity = '1';
    }, delay);
  }

  body.appendChild(svg);

  const legend = body.createDiv({ cls: 'st-hm-legend' });
  legend.createSpan({ text: t('stats.hm.less') });
  for (const c of palette) {
    const dot = legend.createSpan({ cls: 'st-hm-dot' });
    dot.style.background = c;
  }
  legend.createSpan({ text: t('stats.hm.more') });
}

function renderMinutesCard(parent: HTMLElement, data: Array<{ date: string; minutes: number }>): void {
  const card = statCardHead(parent, t('stats.card.minutes'));

  const body = card.createDiv({ cls: 'st-card-body st-chart' });
  const values = data.map(d => d.minutes);
  const W = 320, H = 200, P = { l: 26, r: 8, t: 14, b: 24 };
  const max = Math.max(...values, 1);
  const bw = (W - P.l - P.r) / values.length;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = '100%'; svg.style.height = '200px';

  for (let i = 0; i < values.length; i++) {
    const h = (values[i] / max) * (H - P.t - P.b);
    const x = P.l + i * bw;
    const y = H - P.b - h;
    const isWeekend = (i % 7 === 5 || i % 7 === 6);
    const finalOpacity = values[i] === 0 ? 0.5 : 1;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x + 0.5));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(bw - 1));
    rect.setAttribute('height', String(Math.max(0, h)));
    rect.setAttribute('rx', '1.5');
    rect.setAttribute('fill', values[i] === 0 ? 'var(--gs-line)' : (isWeekend ? 'var(--gs-gold)' : 'var(--gs-green-2)'));
    rect.setAttribute('opacity', '0');
    rect.style.transformBox = 'fill-box';
    rect.style.transformOrigin = 'center bottom';
    rect.style.transform = 'scaleY(0)';
    rect.style.transition = 'transform .7s cubic-bezier(.2,.7,.3,1), opacity .3s ease-out';
    svg.appendChild(rect);

    const delay = Math.round((i / Math.max(1, values.length - 1)) * 600) + 30;
    window.setTimeout(() => {
      if (!rect.isConnected) return;
      rect.style.transform = 'scaleY(1)';
      rect.setAttribute('opacity', String(finalOpacity));
    }, delay);
  }

  body.appendChild(svg);

  const legend = body.createDiv({ cls: 'st-mb-legend' });
  const wd = legend.createDiv();
  setHtml(wd, `<span class="st-mb-dot" style="background:var(--gs-green-2)"></span> ${escapeHtml(t('stats.mb.weekday'))}`);
  const we = legend.createDiv();
  setHtml(we, `<span class="st-mb-dot" style="background:var(--gs-gold)"></span> ${escapeHtml(t('stats.mb.weekend'))}`);
  const activeMin = values.filter(v => v > 0);
  const avg = activeMin.length > 0 ? Math.round(activeMin.reduce((a, b) => a + b, 0) / activeMin.length) : 0;
  const avgDiv = legend.createDiv({ cls: 'st-mb-avg' });
  setHtml(avgDiv, `${escapeHtml(t('stats.mb.avg'))} <strong class="gs-mono">${avg}</strong> ${escapeHtml(t('stats.mb.unit'))}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
