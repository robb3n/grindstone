import { Component, MarkdownRenderer } from 'obsidian';
import { Rating } from '../../card/types';
import { ReviewEngine } from '../../review/review-engine';
import { RATING_LABELS, RATING_KEY_MAP } from '../../review/rating-defs';
import { renderCardAnswer, openCardSource } from '../../review/card-render';
import { TabContext } from './types';
import { countUp } from '../anim';
import { t, StringKey } from '../../i18n';
import { LOCK_SVG } from '../license-teaser';
import { setHtml } from '../../util/dom';

export function renderReview(container: HTMLElement, ctx: TabContext): void {
  const engine = ctx.getReviewEngine();

  if (engine && !engine.isComplete()) {
    renderLiveReview(container, engine, ctx);
  } else if (engine && engine.isComplete()) {
    renderLiveComplete(container, engine, ctx);
  } else {
    renderPreFlight(container, ctx);
  }
}

// ═══════════════════════════════════════════════════════
// Pre-Flight (original review tab)
// ═══════════════════════════════════════════════════════

function renderPreFlight(container: HTMLElement, ctx: TabContext): void {
  const dueCards = ctx.store.getDueCards();
  const dueCount = dueCards.length;
  const dueBreakdown = ctx.store.getDueBreakdown();
  const streak = ctx.store.getOverviewStats().streak;
  const sessions = ctx.store.getRecentSessions(7);

  // ── Page Head ──
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('review.title') });
  const headR = head.createDiv({ cls: 'gs-pagehead-r' });
  headR.createSpan({ cls: 'gs-pill gs-pill-clay', text: t('review.pill_due', { n: dueCount }) });
  headR.createSpan({ cls: 'gs-pill', text: t('review.pill_streak', { n: streak }) });

  // ── Page Body ──
  const page = container.createDiv({ cls: 'gs-page rv-page' });

  // Tabs
  type TabId = 'launch' | 'debrief';
  let activeTab: TabId = 'launch';
  const tabs = page.createDiv({ cls: 'rv-tabs' });
  const sectionWrap = page.createDiv({ cls: 'rv-section-wrap' });

  const SECTIONS: { id: TabId; labelKey: StringKey }[] = [
    { id: 'launch',  labelKey: 'review.tab.launch' },
    { id: 'debrief', labelKey: 'review.tab.debrief' },
  ];

  const indicator = tabs.createSpan({ cls: 'rv-tab-ind' });
  const tabBtns: Partial<Record<TabId, HTMLButtonElement>> = {};

  const positionIndicator = () => {
    const active = tabBtns[activeTab];
    if (!active) return;
    const padLeft = parseFloat(getComputedStyle(tabs).paddingLeft) || 0;
    const padTop = parseFloat(getComputedStyle(tabs).paddingTop) || 0;
    const x = active.offsetLeft - padLeft;
    const y = active.offsetTop - padTop;
    indicator.style.width = active.offsetWidth + 'px';
    indicator.style.transform = `translate(${x}px, ${y}px)`;
  };

  for (const s of SECTIONS) {
    const btn = tabs.createEl('button', { cls: `rv-tab${activeTab === s.id ? ' rv-tab-on' : ''}` });
    btn.createSpan({ cls: 'rv-tab-zh', text: t(s.labelKey) });
    btn.addEventListener('click', () => {
      if (activeTab === s.id) return;
      const prev = tabBtns[activeTab];
      prev?.removeClass('rv-tab-on');
      btn.addClass('rv-tab-on');
      activeTab = s.id;
      positionIndicator();
      renderSection();
    });
    tabBtns[s.id] = btn;
  }

  const renderSection = () => {
    sectionWrap.empty();
    if (activeTab === 'launch') renderLaunch(sectionWrap, dueCount, dueBreakdown, ctx);
    else if (activeTab === 'debrief') renderDebrief(sectionWrap, sessions, ctx);
  };

  // Initial position (suppress animation on first paint by adding then removing a flag)
  tabs.addClass('rv-tabs-init');
  requestAnimationFrame(() => {
    positionIndicator();
    requestAnimationFrame(() => tabs.removeClass('rv-tabs-init'));
  });

  renderSection();
}

// ── Launch ──

function renderLaunch(
  parent: HTMLElement,
  dueCount: number,
  dueBreakdown: { new: number; learning: number; mature: number },
  ctx: TabContext,
): void {
  const launch = parent.createDiv({ cls: 'rv-launch' });
  const left = launch.createDiv({ cls: 'rv-launch-l' });

  // Header (no decorative eyebrow)
  const hdr = left.createDiv({ cls: 'rv-launch-h' });
  hdr.createEl('h2', { cls: 'rv-launch-title', text: t('review.launch.title') });
  hdr.createEl('p', { cls: 'rv-launch-sub', text: t('review.launch.sub') });

  // ── Deck scope (root-tag granularity) ──
  // A single selected Entry drives the breakdown cells and CTA. tag undefined = all.
  type Entry = { el?: HTMLElement; tag?: string; count: number; breakdown: typeof dueBreakdown };
  const allEntry: Entry = { tag: undefined, count: dueCount, breakdown: dueBreakdown };
  let sel: Entry = allEntry;

  const decks = ctx.store.getReviewDecks();

  // Only worth a picker when more than one root tag has due cards.
  if (decks.length >= 2) {
    const picker = left.createDiv({ cls: 'rv-deck-picker' });
    picker.createSpan({ cls: 'rv-deck-label', text: t('review.deck.label') });
    const pills = picker.createDiv({ cls: 'rv-deck-pills' });

    if (ctx.canUseTab('cards')) {
      allEntry.el = makeDeckPill(pills, t('review.deck.all'), dueCount);
      const entries: Entry[] = [
        allEntry,
        ...decks.map((d) => ({ el: makeDeckPill(pills, d.name, d.due), tag: d.tag, count: d.due, breakdown: d.breakdown })),
      ];
      const select = (e: Entry) => {
        sel = e;
        for (const x of entries) x.el!.toggleClass('rv-deck-pill-on', x === e);
        renderCells(false);
        renderCtaMeta();
      };
      for (const e of entries) e.el!.addEventListener('click', () => select(e));
      allEntry.el.addClass('rv-deck-pill-on');
    } else {
      // Free: scope is locked to the full due queue; nudge toward Pro. The "all"
      // pill is non-interactive here (no handler) — mark it static so it doesn't
      // read as clickable.
      makeDeckPill(pills, t('review.deck.all'), dueCount).addClass('rv-deck-pill-on', 'rv-deck-pill-static');
      const lock = pills.createEl('button', {
        cls: 'rv-deck-pill rv-deck-pill-locked',
        attr: { title: t('review.deck.locked_tip') },
      });
      setHtml(lock.createSpan({ cls: 'rv-deck-lock-icon' }), LOCK_SVG);
      lock.createSpan({ text: t('review.deck.locked') });
      lock.addEventListener('click', () => ctx.openLicenseSettings());
    }
  }

  // Auto queue card
  const autoCard = left.createDiv({ cls: 'rv-auto-card' });
  const autoH = autoCard.createDiv({ cls: 'rv-auto-h' });
  const autoHL = autoH.createDiv({ cls: 'rv-auto-h-l' });
  autoHL.createSpan({ cls: 'rv-auto-zh', text: t('review.auto.title') });
  autoH.createSpan({ cls: 'rv-auto-pill gs-mono', text: t('review.auto.pill') });

  const autoGrid = autoCard.createDiv({ cls: 'rv-auto-grid' });
  // animate on first paint; set values directly when re-rendering on deck switch.
  const renderCells = (animate: boolean) => {
    autoGrid.empty();
    addAutoCell(autoGrid, sel.breakdown.new,      t('review.cell.new'),      animate ? 0   : -1);
    addAutoCell(autoGrid, sel.breakdown.learning, t('review.cell.learning'), animate ? 60  : -1);
    addAutoCell(autoGrid, sel.breakdown.mature,   t('review.cell.mature'),   animate ? 120 : -1);
  };

  autoCard.createDiv({ cls: 'rv-auto-foot', text: t('review.auto.foot') });

  // CTA button — starts inline review for the selected scope
  const cta = left.createEl('button', { cls: 'rv-launch-cta' });
  cta.createSpan({ cls: 'rv-launch-cta-zh', text: t('review.cta_start') });
  const ctaMeta = cta.createSpan({ cls: 'rv-launch-cta-meta gs-mono' });
  const renderCtaMeta = () => {
    ctaMeta.textContent = t('review.cta_meta', {
      count: sel.count,
      minutes: Math.max(1, Math.round(sel.count * 0.5)),
    });
  };
  cta.addEventListener('click', () => ctx.startInlineReview(sel.tag));

  renderCells(true);
  renderCtaMeta();

  // Keyboard hints
  const kbds = left.createDiv({ cls: 'rv-launch-kbds' });
  const k1 = kbds.createSpan();
  k1.createEl('kbd', { text: 'Space' });
  k1.appendText(' ' + t('review.kbd.show'));
  const k2 = kbds.createSpan();
  ['1', '2', '3', '4'].forEach((n, i) => {
    if (i > 0) k2.appendText(' / ');
    k2.createEl('kbd', { text: n });
  });
  k2.appendText(' ' + t('review.kbd.rate'));
  const k3 = kbds.createSpan();
  k3.createEl('kbd', { text: 'Esc' });
  k3.appendText(' ' + t('review.kbd.exit'));
}

// delay < 0 → set the value directly (no count-up), used when re-rendering on deck switch.
function addAutoCell(parent: HTMLElement, value: number, label: string, delay = 0): void {
  const cell = parent.createDiv({ cls: 'rv-auto-cell' });
  const num = cell.createDiv({ cls: 'rv-auto-num gs-mono' });
  if (delay < 0) num.textContent = String(value);
  else countUp(num, value, 900, delay);
  const cap = cell.createDiv({ cls: 'rv-auto-cap' });
  cap.createSpan({ cls: 'rv-auto-cap-zh', text: label });
}

function makeDeckPill(parent: HTMLElement, name: string, count: number): HTMLButtonElement {
  const pill = parent.createEl('button', { cls: 'rv-deck-pill' });
  pill.createSpan({ cls: 'rv-deck-pill-name', text: name });
  pill.createSpan({ cls: 'rv-deck-pill-n gs-mono', text: String(count) });
  return pill;
}

// ═══════════════════════════════════════════════════════
// Live Review
// ═══════════════════════════════════════════════════════

function renderLiveReview(container: HTMLElement, engine: ReviewEngine, ctx: TabContext): void {
  const item = engine.getCurrentItem()!;
  const pos = engine.getPosition();
  const autoShow = engine.isAutoShow();
  const component = new Component();
  component.load();

  let answerShown = autoShow;
  let cardDisplayedAt = Date.now();

  const doneCount = pos.current - 1;
  const remaining = pos.total - pos.current + 1;

  // ── Page Head ──
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('review.title') });
  const headR = head.createDiv({ cls: 'gs-pagehead-r' });
  headR.createSpan({ cls: 'gs-pill gs-pill-green', text: t('review.live.done_pill', { n: doneCount }) });
  headR.createSpan({ cls: 'gs-pill gs-pill-clay', text: t('review.live.left_pill', { n: remaining }) });
  headR.createSpan({ cls: 'gs-pill gs-mono', text: `${pos.current} / ${pos.total}` });

  // Progress bar
  const progressBar = container.createDiv({ cls: 'rv-live-progress' });
  progressBar.createDiv({ cls: 'rv-live-progress-fill' }).style.width = `${engine.getProgress() * 100}%`;

  // Body: single column (card + hints + exit)
  const body = container.createDiv({ cls: 'gs-page rv-live-body' });

  const card = body.createDiv({ cls: 'rv-live-card gs-card' });

  // Card head: tags (left) + jump-to-source + position (right)
  const headRow = card.createDiv({ cls: 'rv-live-head' });
  const tagRow = headRow.createDiv({ cls: 'rv-live-tags' });
  const uniqueTags = [...new Set(item.card.tags)];
  for (const tag of uniqueTags) {
    const display = tag.startsWith('#') ? tag : `#${tag}`;
    tagRow.createSpan({ cls: 'rv-live-tag', text: display });
  }

  const headRight = headRow.createDiv({ cls: 'rv-live-head-r' });
  const jumpBtn = headRight.createEl('button', { cls: 'rv-live-jump', attr: { title: t('review.live.jump_tooltip') } });
  setHtml(jumpBtn, `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7"/></svg>`);
  jumpBtn.createSpan({ text: t('review.live.jump') });
  jumpBtn.addEventListener('click', (e) => jumpToSource(item, ctx, e));
  headRight.createSpan({ cls: 'rv-live-pos gs-mono', text: `${pos.current} / ${pos.total}` });

  // Scrollable middle (Q + A)
  const scroll = card.createDiv({ cls: 'rv-live-scroll' });

  // Question section
  const qSection = scroll.createDiv({ cls: 'rv-live-section' });
  qSection.createDiv({ cls: 'rv-live-eyebrow', text: t('review.live.question') });
  // markdown-preview-view: let reading-mode CSS snippets reach the question side too.
  const questionEl = qSection.createDiv({ cls: 'rv-live-question markdown-preview-view' });
  MarkdownRenderer.render(ctx.app, item.card.blockTitle, questionEl, item.card.file, component);

  // Answer section (hidden until shown)
  const aSection = scroll.createDiv({ cls: 'rv-live-section rv-live-a-section' });
  aSection.createDiv({ cls: 'rv-live-divider' });
  aSection.createDiv({ cls: 'rv-live-eyebrow', text: t('review.live.answer') });
  const answerWrap = aSection.createDiv({ cls: 'rv-live-answer' });
  if (!answerShown) aSection.style.display = 'none';

  if (autoShow) {
    loadInlineAnswer(answerWrap, item, ctx, component);
  }

  // ── Action area (inside card) ──
  const actionArea = card.createDiv({ cls: 'rv-live-action-area' });

  // Show answer button
  const showAnswerBtn = actionArea.createEl('button', { cls: 'rv-live-show-btn' });
  showAnswerBtn.createSpan({ cls: 'rv-live-show-zh', text: t('review.live.show_answer') });
  showAnswerBtn.createEl('kbd', { cls: 'rv-kbd gs-mono', text: 'SPACE' });
  if (autoShow) showAnswerBtn.style.display = 'none';

  // Rating buttons
  const rateRow = actionArea.createDiv({ cls: 'rv-live-ratings' });
  if (!autoShow) rateRow.style.display = 'none';

  const previews = engine.previewIntervals();
  for (const def of RATING_LABELS) {
    const btn = rateRow.createEl('button', { cls: `rv-live-r rv-live-r-${def.rating}` });
    const inner = btn.createDiv({ cls: 'rv-live-r-inner' });
    inner.createEl('kbd', { cls: 'rv-live-r-key gs-mono', text: def.key });
    inner.createDiv({ cls: 'rv-live-r-zh', text: t(`review.live.rate.${def.rating}` as StringKey) });
    inner.createDiv({ cls: 'rv-live-r-interval gs-mono', text: previews[def.rating] });
    btn.addEventListener('click', () => doRate(def.rating));
  }

  // Keyboard hints
  const kbds = body.createDiv({ cls: 'rv-launch-kbds' });
  const k1 = kbds.createSpan();
  k1.createEl('kbd', { text: 'Space' });
  k1.appendText(' ' + t('review.kbd.show'));
  const k2 = kbds.createSpan();
  ['1', '2', '3', '4'].forEach((n, i) => {
    if (i > 0) k2.appendText(' / ');
    k2.createEl('kbd', { text: n });
  });
  k2.appendText(' ' + t('review.kbd.rate'));
  const k3 = kbds.createSpan();
  k3.createEl('kbd', { text: 'Esc' });
  k3.appendText(' ' + t('review.kbd.exit'));

  // Exit session button
  const exitBtn = body.createEl('button', { cls: 'rv-launch-cta' });
  exitBtn.createSpan({ cls: 'rv-launch-cta-zh', text: t('review.live.exit') });
  exitBtn.createSpan({ cls: 'rv-launch-cta-meta gs-mono', text: t('review.live.exit_meta') });
  exitBtn.addEventListener('click', () => {
    component.unload();
    ctx.endInlineReview();
  });

  // Toggle answer
  const toggleAnswer = async () => {
    if (!answerShown) {
      answerShown = true;
      aSection.style.display = '';
      await loadInlineAnswer(answerWrap, item, ctx, component);
      showAnswerBtn.style.display = 'none';
      rateRow.style.display = '';
    }
  };

  showAnswerBtn.addEventListener('click', toggleAnswer);

  // Rate handler
  const doRate = async (rating: Rating) => {
    const elapsed = Date.now() - cardDisplayedAt;
    await engine.rate(rating, elapsed);
    component.unload();
    ctx.refreshTab();
  };

  // Keyboard handler
  const keyHandler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.code === 'Space' && !answerShown) {
      e.preventDefault();
      toggleAnswer();
    } else if (answerShown) {
      const rating = RATING_KEY_MAP[e.key];
      if (rating) {
        e.preventDefault();
        doRate(rating);
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      component.unload();
      ctx.endInlineReview();
    }
  };

  document.addEventListener('keydown', keyHandler);
  component.register(() => document.removeEventListener('keydown', keyHandler));
}

async function loadInlineAnswer(
  container: HTMLElement,
  item: { id: string; card: { file: string; blockTitle: string; tags: string[] } & Record<string, any> },
  ctx: TabContext,
  component: Component,
): Promise<void> {
  container.empty();
  const md = container.createDiv({ cls: 'rv-live-answer-md markdown-rendered' });
  await renderCardAnswer(md, item.card as any, item.id, ctx.cardManager, ctx.app, component);
}

async function jumpToSource(
  item: { id: string; card: { file: string } & Record<string, any> },
  ctx: TabContext,
  e?: MouseEvent,
): Promise<void> {
  const startLine = await ctx.cardManager.getBlockStartLine(item.card as any, item.id);
  await openCardSource(ctx.app, item.card.file, startLine, {
    newTab: !!(e?.ctrlKey || e?.metaKey),
  });
}

// ═══════════════════════════════════════════════════════
// Live Complete
// ═══════════════════════════════════════════════════════

function renderLiveComplete(container: HTMLElement, engine: ReviewEngine, ctx: TabContext): void {
  const pos = engine.getPosition();

  // Header
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('review.done.title') });

  // Progress bar (full)
  const progressBar = container.createDiv({ cls: 'rv-live-progress' });
  progressBar.createDiv({ cls: 'rv-live-progress-fill' }).style.width = '100%';

  // Completion content
  const done = container.createDiv({ cls: 'rv-live-done' });
  done.createEl('h2', { cls: 'rv-live-done-title', text: t('review.done.title') });
  done.createEl('p', { cls: 'rv-live-done-sub', text: t('review.done.sub_total', { total: pos.total }) });

  const actions = done.createDiv({ cls: 'rv-live-done-actions' });
  const backBtn = actions.createEl('button', { cls: 'gs-btn', text: t('review.done.back') });
  backBtn.addEventListener('click', () => ctx.endInlineReview());
  const statsBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('review.done.stats') });
  statsBtn.addEventListener('click', () => {
    ctx.endInlineReview();
    ctx.onNavigate('stats');
  });
}

// ═══════════════════════════════════════════════════════
// History & Debrief
// ═══════════════════════════════════════════════════════

function renderHistory(parent: HTMLElement, sessions: any[]): void {
  const hist = parent.createDiv({ cls: 'rv-history' });

  const totalCards = sessions.reduce((a: number, s: any) => a + s.cards, 0);
  const totalMin = sessions.reduce((a: number, s: any) => a + s.minutes, 0);
  const activeDays = sessions.filter((s: any) => s.cards > 0).length;

  const strip = hist.createDiv({ cls: 'rv-history-strip' });
  addHistKPI(strip, t('review.debrief.hist.cards'),   String(totalCards));
  addHistKPI(strip, t('review.debrief.hist.minutes'), `${totalMin}${t('review.debrief.minutes_unit')}`);
  addHistKPI(strip, t('review.debrief.hist.active'),  `${activeDays}${t('review.debrief.active_unit')}`);
  addHistKPI(strip, t('review.debrief.hist.avg'),     String(Math.round(totalCards / 7)));

  const list = hist.createEl('ul', { cls: 'rv-history-list' });
  for (const s of sessions) {
    const row = list.createEl('li', { cls: `rv-hist-row${s.cards === 0 ? ' rv-hist-skip' : ''}` });
    const dateDiv = row.createDiv({ cls: 'rv-hist-date' });
    dateDiv.createSpan({ cls: 'rv-hist-date-d gs-mono', text: s.date });

    if (s.cards === 0) {
      row.createDiv({ cls: 'rv-hist-empty', text: t('review.debrief.rest_day') });
    } else {
      const meta = row.createDiv({ cls: 'rv-hist-meta' });
      const nSpan = meta.createSpan({ cls: 'rv-hist-n gs-mono' });
      nSpan.textContent = String(s.cards);
      nSpan.createSpan({ text: ' ' + t('review.debrief.cards_unit') });
      const mSpan = meta.createSpan({ cls: 'rv-hist-m gs-mono' });
      mSpan.textContent = String(s.minutes);
      mSpan.createSpan({ text: t('review.debrief.minutes_unit') });

      const barDiv = row.createDiv({ cls: 'rv-hist-bar' });
      if (s.ratings) renderRatingBar(barDiv, s.ratings, s.cards);

      row.createDiv({ cls: 'rv-hist-scope gs-mono', text: s.scope?.join(' + ') || '' });
    }
  }
}

function addHistKPI(parent: HTMLElement, label: string, value: string): void {
  const kpi = parent.createDiv({ cls: 'rv-histkpi' });
  kpi.createDiv({ cls: 'rv-histkpi-num gs-mono gs-tabular', text: value });
  const labelEl = kpi.createDiv({ cls: 'rv-histkpi-l' });
  labelEl.createSpan({ cls: 'rv-histkpi-zh', text: label });
}

function renderRatingBar(parent: HTMLElement, ratings: Record<string, number>, total: number): void {
  const bar = parent.createDiv({ cls: 'rv-ratebar' });
  const segs = [
    { k: 'again', v: ratings.again ?? 0, c: 'var(--gs-clay)' },
    { k: 'hard', v: ratings.hard ?? 0, c: 'var(--gs-gold)' },
    { k: 'good', v: ratings.good ?? 0, c: 'var(--gs-green)' },
    { k: 'easy', v: ratings.easy ?? 0, c: 'var(--gs-green-2)' },
  ];
  for (const s of segs) {
    if (s.v > 0) {
      const seg = bar.createDiv({ cls: 'rv-ratebar-seg' });
      seg.style.flex = String(s.v);
      seg.style.background = s.c;
      seg.createSpan({ cls: 'rv-ratebar-n gs-mono', text: String(s.v) });
    }
  }
}

function renderDebrief(parent: HTMLElement, sessions: any[], ctx: TabContext): void {
  const last = sessions.find((s: any) => s.cards > 0);
  if (!last) {
    parent.createDiv({ cls: 'rv-debrief-empty', text: t('review.debrief.empty') });
    return;
  }

  const debrief = parent.createDiv({ cls: 'rv-debrief' });
  const r = last.ratings;
  const accuracy = r ? Math.round(((r.good + r.easy) / last.cards) * 100) : 0;

  // ── Section 1: 上次会话 ──
  const sec1Head = debrief.createDiv({ cls: 'rv-section-head' });
  sec1Head.createEl('h2', { cls: 'rv-section-title', text: t('review.debrief.last') });
  sec1Head.createDiv({ cls: 'rv-section-sub gs-mono', text: t('review.debrief.last_meta', { date: last.date, minutes: last.minutes }) });

  const hdr = debrief.createEl('header', { cls: 'rv-debrief-h' });
  const hdrL = hdr.createDiv();
  hdrL.createEl('h2', { cls: 'rv-debrief-title', text: t('review.debrief.cards_meta', { cards: last.cards, minutes: last.minutes }) });
  hdrL.createEl('p', { cls: 'rv-debrief-scope gs-mono', text: last.scope?.join(' + ') || '' });

  const accDiv = hdr.createDiv({ cls: 'rv-debrief-acc' });
  const accNum = accDiv.createDiv({ cls: 'rv-debrief-acc-num gs-mono' });
  accNum.textContent = String(accuracy);
  accNum.createSpan({ text: '%' });
  const accLabel = accDiv.createDiv({ cls: 'rv-debrief-acc-l' });
  accLabel.createSpan({ text: t('review.debrief.acc') });

  if (r) {
    const grid = debrief.createDiv({ cls: 'rv-debrief-grid' });
    addDebriefRate(grid, t('review.debrief.rate.again'), '1', r.again ?? 0, last.cards, 'var(--gs-clay)');
    addDebriefRate(grid, t('review.debrief.rate.hard'),  '2', r.hard,        last.cards, 'var(--gs-gold)');
    addDebriefRate(grid, t('review.debrief.rate.good'),  '3', r.good,        last.cards, 'var(--gs-green)');
    addDebriefRate(grid, t('review.debrief.rate.easy'),  '4', r.easy,        last.cards, 'var(--gs-green-2)');
  }

  if (r) {
    const barSection = debrief.createDiv({ cls: 'rv-debrief-bar' });
    barSection.createDiv({ cls: 'rv-debrief-bar-h', text: t('review.debrief.dist') });
    renderRatingBar(barSection, r, last.cards);
  }

  const actions = debrief.createDiv({ cls: 'rv-debrief-actions' });
  const btnOverview = actions.createEl('button', { cls: 'gs-btn', text: t('review.debrief.back') });
  btnOverview.addEventListener('click', () => ctx.onNavigate('overview'));
  const btnStats = actions.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('review.debrief.full') });
  btnStats.addEventListener('click', () => ctx.onNavigate('stats'));

  // ── Section 2: 历史与累计 ──
  const sec2Head = debrief.createDiv({ cls: 'rv-section-head rv-section-head-2' });
  sec2Head.createEl('h2', { cls: 'rv-section-title', text: t('review.debrief.history') });
  sec2Head.createDiv({ cls: 'rv-section-sub gs-mono', text: t('review.debrief.recent_7') });

  renderHistory(debrief, sessions);
}

function addDebriefRate(parent: HTMLElement, label: string, key: string, value: number, total: number, color: string): void {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const card = parent.createDiv({ cls: 'rv-debrief-rate' });
  card.style.setProperty('--c', color);
  const hdr = card.createDiv({ cls: 'rv-debrief-rate-h' });
  hdr.createSpan({ cls: 'rv-debrief-rate-zh', text: label });
  hdr.createEl('kbd', { cls: 'rv-kbd', text: key });
  card.createDiv({ cls: 'rv-debrief-rate-num gs-mono', text: String(value) });
  card.createDiv({ cls: 'rv-debrief-rate-pct gs-mono', text: `${pct}%` });
}
