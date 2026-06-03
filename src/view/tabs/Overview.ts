import { App, Notice } from 'obsidian';
import { TabContext } from './types';
import { RatingsData } from '../../store/GrindstoneStore';
import { countUp } from '../anim';
import { t, getLang, StringKey } from '../../i18n';
import { setHtml } from '../../util/dom';

const DEMO_FILE_BASENAME = 'Grindstone Demo';
const DEMO_CONTENT_ZH = `# Grindstone Demo

#grind 什么是间隔重复（Spaced Repetition）？
一种根据"遗忘曲线"安排复习时机的学习方法：每复习一次，下次复习的间隔会变长，从而让长期记忆更稳。

---

#grind 磨石如何把一行文字变成一张卡片？
任何含有触发标签（默认 \`#grind\`）的行就是一张卡片的开头。
- 题面 = 该行去掉标签后的文字
- 答案 = 从该行到下一个分隔符 \`---\` / 下一张卡 / 下一个标题之间的内容

---

#grind 复习评分有哪四档？
- **1 Again** — 没记住，短间隔再练
- **2 Hard** — 难，间隔较短
- **3 Good** — 可，标准间隔增长
- **4 Easy** — 易，间隔大幅增长

---

#grind 卡组（deck）是什么？
卡组就是顶级标签。比如 \`#grind/biology/cells\` 这张卡的卡组是 \`grind\`，子标签 \`biology/cells\` 用于组织和筛选。

---

#grind 这张演示笔记可以删吗？
可以。删除文件后，对应的卡片会自动从复习队列移除。
你也可以在 Settings 里改触发标签，把 \`#grind\` 换成自己想用的标签（比如 \`#flashcard\`、\`#anki\`）。
`;

const DEMO_CONTENT_EN = `# Grindstone Demo

#grind What is spaced repetition?
A study technique that schedules each review based on the forgetting curve: the better you remember a card, the longer the gap before you see it again — which lets long-term memory settle in with the least effort.

---

#grind How does Grindstone turn a line of text into a card?
Any line that contains your trigger tag (default \`#grind\`) becomes the start of a card.
- Question = the line itself, minus the tag
- Answer = everything between that line and the next divider \`---\`, the next card, or the next heading

---

#grind What are the four rating buttons?
- **1 Again** — didn't recall, retry on a short interval
- **2 Hard** — recalled with effort; shorter interval
- **3 Good** — recalled fine; standard interval growth
- **4 Easy** — trivial; big interval jump

---

#grind What is a deck?
A deck is the top-level tag. For example, in \`#grind/biology/cells\` the deck is \`grind\`; the sub-tags \`biology/cells\` are for organization and filtering.

---

#grind Can I delete this demo note?
Yes. Delete the file and its cards drop out of the review queue automatically.
You can also change the trigger tag in Settings — swap \`#grind\` for whatever you prefer (e.g. \`#flashcard\`, \`#anki\`).
`;

export const DEFAULT_SLOGANS = [
  '迈进',
  '纸上得来终觉浅',
  '博观约取',
  '厚积薄发',
  '等待与希望',
  '不积跬步，无以至千里',
];

const DAY_KEYS: StringKey[] = [
  'overview.day.sun',
  'overview.day.mon',
  'overview.day.tue',
  'overview.day.wed',
  'overview.day.thu',
  'overview.day.fri',
  'overview.day.sat',
];

export function renderOverview(container: HTMLElement, ctx: TabContext): void {
  const stats = ctx.store.getOverviewStats();
  const forecast = ctx.store.getForecast7D();
  const progress = ctx.store.getTodayProgress();
  const maturity = ctx.store.getMaturity();
  const ratings = ctx.store.getRatingsDistribution();
  const heatmap = ctx.store.get12WeekHeatmap();
  const topTags = ctx.store.getTopTags(6);

  // ── Page Head ──
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('overview.title') });

  const headR = head.createDiv({ cls: 'gs-pagehead-r' });

  // Motivational quote — re-rolled every time Overview renders
  const userSlogans = ctx.store.getSettings().customSlogans?.filter((s) => s.trim().length > 0) ?? [];
  const pool = userSlogans.length > 0 ? userSlogans : DEFAULT_SLOGANS;
  const motiv = pool[Math.floor(Math.random() * pool.length)];
  const quote = headR.createDiv({ cls: 'ov-quote' });
  quote.createSpan({ text: motiv });

  // CTA — fast path: skip pre-flight, dive straight into the inline session.
  const cta = headR.createEl('button', { cls: 'gs-btn gs-btn-primary ov-cta' });
  cta.textContent = t('overview.cta_start', { due: stats.due });
  cta.disabled = stats.due === 0;
  cta.addEventListener('click', () => {
    if (stats.due > 0) ctx.startInlineReview();
  });

  // ── Page Body ──
  const page = container.createDiv({ cls: 'gs-page ov-page' });

  // Empty state
  const totalCards = maturity.new + maturity.learning + maturity.mature;
  if (totalCards === 0) {
    renderEmptyState(page, ctx);
    return;
  }

  // ── Stat Strip ──
  const strip = page.createDiv({ cls: 'ov-strip' });
  addStat(strip, t('overview.stat.due'),    stats.due,         undefined, true,  0);
  addStat(strip, t('overview.stat.done'),   stats.done,        undefined, false, 60);
  addStat(strip, t('overview.stat.left'),   stats.remaining,   undefined, false, 120);
  addStat(strip, t('overview.stat.streak'), stats.streak,      t('common.day_short'),    false, 180);
  addStat(strip, t('overview.stat.week'),   stats.weekMinutes, t('common.minute_short'), false, 240);
  addStat(strip, t('overview.stat.tags'),   stats.tagCount,    undefined, false, 300);

  // ── Tile Grid ──
  const grid = page.createDiv({ cls: 'ov-grid' });

  // Forecast tile
  renderForecastTile(grid, forecast);
  // Progress tile
  renderProgressTile(grid, progress);
  // Maturity tile
  renderMaturityTile(grid, maturity);
  // Ratings tile
  renderRatingsTile(grid, ratings);
  // Heatmap tile
  renderHeatmapTile(grid, heatmap);
  // Tags tile
  renderTagsTile(grid, topTags, ctx);
}

// ── Stat Strip Item ──

function addStat(parent: HTMLElement, label: string, value: number, suffix?: string, accent?: boolean, delay = 0): void {
  const stat = parent.createDiv({ cls: 'ov-stat' });
  const top = stat.createDiv({ cls: 'ov-stat-top' });
  top.createSpan({ cls: 'ov-stat-zh', text: label });
  const numEl = stat.createDiv({ cls: `ov-stat-num gs-mono gs-tabular${accent ? ' ov-stat-accent' : ''}` });
  const valSpan = numEl.createSpan();
  countUp(valSpan, value, 900, delay);
  if (suffix) {
    numEl.createSpan({ cls: 'ov-stat-suffix', text: suffix });
  }
}

// ── Tiles ──

function tileHead(parent: HTMLElement, title: string): void {
  const th = parent.createDiv({ cls: 'ov-th' });
  th.createSpan({ cls: 'ov-th-zh', text: title });
}

function renderForecastTile(grid: HTMLElement, forecast: ReturnType<typeof import('../../store/GrindstoneStore').GrindstoneStore.prototype.getForecast7D>): void {
  const tile = grid.createDiv({ cls: 'gs-card gs-hoverable ov-tile ov-t-forecast' });
  tileHead(tile, t('overview.tile.forecast'));

  const max = Math.max(...forecast.map(f => f.count), 1);
  const fore = tile.createDiv({ cls: 'ov-fore' });

  forecast.forEach((f, idx) => {
    const col = fore.createDiv({ cls: 'ov-fc' });
    const barWrap = col.createDiv({ cls: 'ov-fc-bar-wrap' });
    const bar = barWrap.createDiv({
      cls: `ov-fc-bar${f.isToday ? ' ov-fc-today' : ''}`,
    });
    const targetH = Math.max(22, (f.count / max) * 100);
    bar.style.height = '0%';
    window.setTimeout(() => {
      if (!bar.isConnected) return;
      bar.style.height = `${targetH}%`;
    }, idx * 60 + 16);
    bar.createSpan({ cls: 'ov-fc-n gs-mono', text: String(f.count) });

    col.createDiv({
      cls: `ov-fc-d gs-mono${f.isToday ? ' ov-fc-d-today' : ''}`,
      text: localizeDayLabel(f.label, f.isToday),
    });
  });
}

/**
 * Forecast labels come from the store as Chinese single-char abbreviations
 * (今/一/二/...). Map them back to the i18n dictionary so EN users see Mon/Tue.
 */
function localizeDayLabel(raw: string, isToday: boolean): string {
  if (isToday) return t('overview.day.today');
  const map: Record<string, StringKey> = {
    '一': 'overview.day.mon',
    '二': 'overview.day.tue',
    '三': 'overview.day.wed',
    '四': 'overview.day.thu',
    '五': 'overview.day.fri',
    '六': 'overview.day.sat',
    '日': 'overview.day.sun',
  };
  const key = map[raw];
  return key ? t(key) : raw;
}

function renderProgressTile(grid: HTMLElement, progress: { done: number; total: number }): void {
  const tile = grid.createDiv({ cls: 'gs-card gs-hoverable ov-tile ov-t-progress' });
  tileHead(tile, t('overview.tile.progress'));

  const prog = tile.createDiv({ cls: 'ov-prog' });
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  // SVG ring
  const size = 130;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', String(size / 2));
  track.setAttribute('cy', String(size / 2));
  track.setAttribute('r', String(r));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--gs-line)');
  track.setAttribute('stroke-width', String(stroke));
  svg.appendChild(track);

  const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fill.setAttribute('cx', String(size / 2));
  fill.setAttribute('cy', String(size / 2));
  fill.setAttribute('r', String(r));
  fill.setAttribute('fill', 'none');
  fill.setAttribute('stroke', 'var(--gs-green)');
  fill.setAttribute('stroke-width', String(stroke));
  fill.setAttribute('stroke-linecap', 'round');
  fill.setAttribute('stroke-dasharray', String(c));
  fill.setAttribute('stroke-dashoffset', String(c));
  fill.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  fill.style.transition = 'stroke-dashoffset .9s cubic-bezier(.215,.61,.355,1)';
  svg.appendChild(fill);

  prog.appendChild(svg);

  const targetOffset = c * (1 - (progress.total === 0 ? 0 : progress.done / progress.total));
  window.setTimeout(() => {
    if (!fill.isConnected) return;
    fill.setAttribute('stroke-dashoffset', String(targetOffset));
  }, 16);

  const overlay = prog.createDiv({ cls: 'ov-prog-overlay' });
  overlay.createDiv({ cls: 'ov-prog-pct gs-mono', text: `${pct}%` });
  overlay.createDiv({ cls: 'ov-prog-cap', text: `${progress.done} / ${progress.total}` });
}

function renderMaturityTile(grid: HTMLElement, maturity: { new: number; learning: number; mature: number }): void {
  const tile = grid.createDiv({ cls: 'gs-card gs-hoverable ov-tile ov-t-maturity' });
  tileHead(tile, t('overview.tile.maturity'));

  const total = maturity.new + maturity.learning + maturity.mature;
  const rows = tile.createDiv({ cls: 'ov-mat-rows' });

  addMatRow(rows, t('overview.maturity.new'),      maturity.new,      total, 'var(--gs-clay)',  0);
  addMatRow(rows, t('overview.maturity.learning'), maturity.learning, total, 'var(--gs-gold)',  1);
  addMatRow(rows, t('overview.maturity.mature'),   maturity.mature,   total, 'var(--gs-green)', 2);
}

function addMatRow(parent: HTMLElement, label: string, value: number, total: number, color: string, idx: number): void {
  const pct = total === 0 ? 0 : (value / total) * 100;
  const row = parent.createDiv({ cls: 'ov-mat' });

  const left = row.createDiv({ cls: 'ov-mat-l' });
  const dot = left.createSpan({ cls: 'ov-mat-dot' });
  dot.style.background = color;
  left.createSpan({ cls: 'ov-mat-zh', text: label });

  const bar = row.createDiv({ cls: 'ov-mat-bar' });
  const barFill = bar.createDiv();
  barFill.style.width = '0%';
  barFill.style.background = color;
  window.setTimeout(() => {
    if (!barFill.isConnected) return;
    barFill.style.width = `${pct}%`;
  }, idx * 80 + 16);

  row.createSpan({ cls: 'ov-mat-n gs-mono', text: String(value) });
}

function renderRatingsTile(grid: HTMLElement, ratings: RatingsData): void {
  const tile = grid.createDiv({ cls: 'gs-card gs-hoverable ov-tile ov-t-ratings' });
  tileHead(tile, t('overview.tile.ratings'));

  const total = ratings.again + ratings.hard + ratings.good + ratings.easy;

  if (total === 0) {
    tile.createDiv({ cls: 'ov-rate-empty', text: t('overview.ratings_empty') });
    return;
  }

  const rate = tile.createDiv({ cls: 'ov-rate' });

  // Half-circle gauge
  const gaugeWrap = rate.createDiv({ cls: 'ov-rate-gauge' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const W = 200, H = 110, R = 80, STROKE = 14;
  const cx = W / 2, cy = H - 12;
  const arcLen = Math.PI * R;
  const arcD = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`;

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('d', arcD);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--gs-line)');
  track.setAttribute('stroke-width', String(STROKE));
  track.setAttribute('stroke-linecap', 'butt');
  svg.appendChild(track);

  const segs = [
    { pct: ratings.againPct, color: 'var(--gs-clay)' },
    { pct: ratings.hardPct,  color: 'var(--gs-gold)' },
    { pct: ratings.goodPct,  color: 'var(--gs-green)' },
    { pct: ratings.easyPct,  color: 'var(--gs-green-2)' },
  ];

  const segGap = 2.5;
  let cum = 0;
  const segPaths: { el: SVGPathElement; len: number }[] = [];
  for (const seg of segs) {
    const portion = (seg.pct / 100) * arcLen;
    const visible = Math.max(0, portion - segGap);
    if (portion > 0) {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', arcD);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', seg.color);
      p.setAttribute('stroke-width', String(STROKE));
      p.setAttribute('stroke-linecap', 'butt');
      p.setAttribute('stroke-dasharray', `0 ${arcLen}`);
      p.setAttribute('stroke-dashoffset', String(-cum));
      p.style.transition = 'stroke-dasharray .9s cubic-bezier(.215,.61,.355,1)';
      svg.appendChild(p);
      segPaths.push({ el: p, len: visible });
    }
    cum += portion;
  }

  gaugeWrap.appendChild(svg);

  const accuracy = ratings.goodPct + ratings.easyPct;
  const center = gaugeWrap.createDiv({ cls: 'ov-rate-center' });
  center.createDiv({ cls: 'ov-rate-acc gs-mono', text: `${accuracy}%` });
  center.createDiv({ cls: 'ov-rate-acc-l', text: t('overview.accuracy_label') });

  window.setTimeout(() => {
    for (const { el, len } of segPaths) {
      if (el.isConnected) el.setAttribute('stroke-dasharray', `${len} ${arcLen}`);
    }
  }, 16);

  // Legend
  const legend = rate.createDiv({ cls: 'ov-rate-legend' });
  addLegendItem(legend, t('overview.rating.again'), ratings.againPct, 'var(--gs-clay)');
  addLegendItem(legend, t('overview.rating.hard'),  ratings.hardPct,  'var(--gs-gold)');
  addLegendItem(legend, t('overview.rating.good'),  ratings.goodPct,  'var(--gs-green)');
  addLegendItem(legend, t('overview.rating.easy'),  ratings.easyPct,  'var(--gs-green-2)');
}

function addLegendItem(parent: HTMLElement, label: string, pct: number, color: string): void {
  const item = parent.createDiv({ cls: 'ov-rate-li' });
  const dot = item.createSpan({ cls: 'ov-rate-li-dot' });
  dot.style.background = color;
  item.createSpan({ cls: 'ov-rate-li-name', text: label });
  const v = item.createSpan({ cls: 'ov-rate-li-pct gs-mono', text: `${pct}%` });
  v.style.color = color;
}

function renderHeatmapTile(grid: HTMLElement, cells: number[]): void {
  const tile = grid.createDiv({ cls: 'gs-card gs-hoverable ov-tile ov-t-heat' });
  tileHead(tile, t('overview.tile.heatmap'));

  const cols = 12;
  const rows = 7;
  const cellSize = 11;
  const gap = 3;
  const palette = ['var(--gs-line)', 'var(--gs-green-soft)', '#9bbcaa', '#5b8d75', 'var(--gs-green)'];

  const w = cols * (cellSize + gap) - gap;
  const h = rows * (cellSize + gap) - gap;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';

  for (let i = 0; i < cells.length; i++) {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(col * (cellSize + gap)));
    rect.setAttribute('y', String(row * (cellSize + gap)));
    rect.setAttribute('width', String(cellSize));
    rect.setAttribute('height', String(cellSize));
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', palette[Math.min(4, Math.max(0, cells[i]))]);
    rect.style.transformBox = 'fill-box';
    rect.style.transformOrigin = 'center';
    rect.style.transform = 'scale(0)';
    rect.style.opacity = '0';
    rect.style.transition = 'transform .42s cubic-bezier(.2,.7,.3,1), opacity .28s ease-out';
    svg.appendChild(rect);

    const delay = col * 32 + row * 8 + 40;
    window.setTimeout(() => {
      if (!rect.isConnected) return;
      rect.style.transform = 'scale(1)';
      rect.style.opacity = '1';
    }, delay);
  }

  tile.appendChild(svg);

  // Footer legend
  const foot = tile.createDiv({ cls: 'ov-heat-foot gs-mono' });
  foot.createSpan({ text: t('overview.heatmap_foot') });
  const scale = foot.createDiv({ cls: 'ov-heat-scale' });
  for (let i = 0; i < 5; i++) {
    const dot = scale.createDiv();
    dot.style.width = '9px';
    dot.style.height = '9px';
    dot.style.borderRadius = '2px';
    dot.style.background = palette[i];
  }
}

function renderTagsTile(grid: HTMLElement, tags: Array<{ path: string; count: number }>, ctx: TabContext): void {
  const tile = grid.createDiv({ cls: 'gs-card gs-hoverable ov-tile ov-t-tags' });
  tileHead(tile, t('overview.tile.tags'));

  const max = Math.max(...tags.map(t => t.count), 1);
  const list = tile.createDiv({ cls: 'ov-tags' });

  tags.forEach((tag, i) => {
    const btn = list.createEl('button', { cls: 'ov-tag' });
    btn.addEventListener('click', () => ctx.onNavigate('tags', { tag: tag.path }));
    btn.createSpan({ cls: 'ov-tag-path', text: tag.path });
    const meter = btn.createSpan({ cls: 'ov-tag-meter' });
    const fill = meter.createSpan();
    fill.style.width = '0%';
    const targetW = (tag.count / max) * 100;
    window.setTimeout(() => {
      if (!fill.isConnected) return;
      fill.style.width = `${targetW}%`;
    }, i * 60 + 40);
    btn.createSpan({ cls: 'ov-tag-n gs-mono', text: String(tag.count) });
  });

  const more = list.createEl('button', { cls: 'ov-tag-more' });
  more.textContent = t('overview.tags_more', { n: tags.length });
  more.addEventListener('click', () => ctx.onNavigate('tags'));
}

// ── Helpers ──

function renderEmptyState(parent: HTMLElement, ctx: TabContext): void {
  const empty = parent.createDiv({ cls: 'gs-empty-state' });
  const icon = empty.createDiv({ cls: 'gs-empty-icon' });
  setHtml(icon, `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12L12 20l-9-9V3h8z"/><circle cx="7" cy="7" r="1.2"/></svg>`);
  empty.createDiv({ cls: 'gs-empty-title', text: t('overview.empty_title') });
  empty.createDiv({ cls: 'gs-empty-sub', text: t('overview.empty_sub') });
  empty.createDiv({ cls: 'gs-empty-hint', text: '#grind' });

  // Quick-start: one-click demo note.
  const actions = empty.createDiv({ cls: 'gs-empty-actions' });
  const demoBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('overview.empty_cta') });
  demoBtn.addEventListener('click', () => createDemoNote(ctx, demoBtn));
  actions.createDiv({ cls: 'gs-empty-actions-hint', text: t('overview.empty_hint') });
}

async function createDemoNote(ctx: TabContext, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = t('overview.empty_creating');
  try {
    const path = pickAvailableDemoPath(ctx.app);
    const content = getLang() === 'zh' ? DEMO_CONTENT_ZH : DEMO_CONTENT_EN;
    const file = await ctx.app.vault.create(path, content);
    // Metadata cache indexes asynchronously — give it a tick before scanning.
    await new Promise(r => setTimeout(r, 200));
    await ctx.cardManager.scanFile(file);
    await ctx.store.save();
    new Notice(t('overview.demo_created', { path }));
    ctx.refreshTab();
  } catch (err) {
    console.error('[Grindstone] Demo creation failed:', err);
    new Notice(t('overview.demo_failed', { err: err instanceof Error ? err.message : String(err) }));
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function pickAvailableDemoPath(app: App): string {
  const base = `${DEMO_FILE_BASENAME}.md`;
  if (!app.vault.getAbstractFileByPath(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${DEMO_FILE_BASENAME} ${i}.md`;
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
  return `${DEMO_FILE_BASENAME} ${Date.now()}.md`;
}
