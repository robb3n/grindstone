import { MarkdownRenderer, Component, Menu, Notice, setTooltip, setIcon } from 'obsidian';
import { TagTreeNode, CardEntry } from '../../store/GrindstoneStore';
import { TabContext } from './types';
import { today as formatToday } from '../../util/date';
import { matchesAnyPrefix } from '../../util/tag-match';
import { t, StringKey } from '../../i18n';
import { bindFootnotePopovers, bindAnswerLinks, openCardSource } from '../../review/card-render';
import { CustomDeck, DeckFilter, Maturity, normMaturity } from '../../card/types';
import { SaveDeckModal, DeckManageModal, EditDeckModal, confirmDeleteDeck, findMatchingDeck } from '../deck-modals';
import { RenameTagModal } from '../modals/rename-tag-modal';
import { stripHash } from '../../services/tag-rename';
import { setHtml } from '../../util/dom';

type SortField = 'front' | 'ef' | 'due' | 'created';
type SortDir = 'asc' | 'desc';

// Maturity buckets for the sidebar distribution bar (ordered new → learning → mature).
const MATURITY_BUCKETS: Array<{ id: Maturity; labelKey: StringKey }> = [
  { id: 'new',      labelKey: 'tags.chip.new' },
  { id: 'learning', labelKey: 'tags.chip.learning' },
  { id: 'mature',   labelKey: 'tags.chip.mature' },
];

const MATURITY_CHIP_KEY: Record<Maturity, StringKey> = {
  new:      'tags.chip.new',
  learning: 'tags.chip.learning',
  mature:   'tags.chip.mature',
};

function classifyMaturity(card: { reviewCount: number; interval: number }): Maturity {
  if (card.reviewCount === 0) return 'new';
  if (card.interval < 21) return 'learning';
  return 'mature';
}

export function renderTags(container: HTMLElement, ctx: TabContext, initialTag?: string): () => void {
  const component = new Component();
  component.load();

  const selectedTags = new Set<string>(initialTag ? [initialTag] : []);
  let search = '';
  // Maturity is multi-select: the Set holds the "lit" buckets. Default = all three
  // lit = no constraint. Toggling down to zero snaps back to all (empty ≡ all).
  const matSel = new Set<Maturity>(['new', 'learning', 'mature']);
  const matConstrained = () => matSel.size > 0 && matSel.size < 3;
  const matFilterArr = (): Maturity[] => matConstrained() ? [...matSel] : [];
  const ALL_MATURITY = (): Maturity[] => ['new', 'learning', 'mature'];
  const expanded: Record<string, boolean> = {};
  // Default: newest-added first (入库时间降序). 'created' has no column header,
  // so it's the implicit order until the user clicks a sortable column.
  let sortField: SortField = 'created';
  let sortDir: SortDir = 'desc';
  // Sticky pointer: which deck did the user "apply" most recently? Persists
  // through filter edits until the user clears filters or applies a different
  // deck — this is what enables the "覆盖到 <name>" overwrite button after the
  // user modifies an applied deck's filter.
  let appliedDeckId: string | null = null;

  // Active filter snapshot — DeckFilter shape, used for cram launch + deck save/lookup.
  // Declared here as closures over the state above; render fns are declared later
  // and only invoked via applyDeck after the full setup completes (so call-time
  // refs are fine).
  const currentFilter = (): DeckFilter => ({
    tags: [...selectedTags],
    search,
    maturity: matFilterArr(),
  });

  const hasActiveFilter = (): boolean =>
    selectedTags.size > 0 || search.length > 0 || matConstrained();

  const getCustomDecks = (): CustomDeck[] => ctx.store.getSettings().customDecks ?? [];

  let tree = ctx.store.getTagTree();
  for (const node of tree) expanded[node.path] = true;

  let allTagPaths: string[] = [];
  const collectTags = (nodes: TagTreeNode[]) => {
    for (const n of nodes) { allTagPaths.push(n.path); collectTags(n.children); }
  };
  collectTags(tree);

  // Re-fetch the tag tree on every renderTree so per-tag counts track card data
  // live — parity with the card side, which re-queries getCardsByTags each render.
  // Without this, `tree` is frozen at tab-open while the “全部卡片” total
  // (getTotalActiveCards) and match pill keep updating, leaving per-tag counts stale.
  const refreshTree = () => {
    tree = ctx.store.getTagTree();
    allTagPaths = [];
    collectTags(tree);
  };

  // ── Page Head ──
  const head = container.createDiv({ cls: 'gs-pagehead tg-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('tags.title') });

  const headR = head.createDiv({ cls: 'gs-pagehead-r' });
  // ⚡ "Cram these N" — visible only when cards.length > 0 (renderMain toggles).
  // Sits to the left of the count pills.
  const cramBtn = headR.createEl('button', { cls: 'gs-pill gs-pill-clay tg-cram-btn' });
  cramBtn.style.display = 'none';
  // Split into spans so the narrow (≤720) tier can collapse it to ⚡+count via CSS.
  cramBtn.createSpan({ cls: 'tg-cram-icon', text: '⚡' });
  cramBtn.createSpan({ cls: 'tg-cram-label', text: t('cram.start_label') });
  const cramN = cramBtn.createSpan({ cls: 'tg-cram-n gs-mono' });
  const cramUnit = t('cram.start_unit');
  if (cramUnit) cramBtn.createSpan({ cls: 'tg-cram-unit', text: cramUnit });
  cramBtn.addEventListener('click', () => {
    const entries = ctx.store.getCardsByTags(selectedTags, search || undefined);
    const ms = matFilterArr();
    const filtered = ms.length === 0
      ? entries
      : entries.filter(e => ms.includes(classifyMaturity(e.card)));
    if (filtered.length === 0) return;
    const filter = currentFilter();
    const sourceDeck = findMatchingDeck(getCustomDecks(), filter);
    const queue = filtered.map(({ id, card }) => ({ id, card }));
    ctx.startCram(queue, filter, sourceDeck?.id);
  });
  const tagCountPill = headR.createSpan({ cls: 'gs-pill tg-count-pill' });
  const matchPill = headR.createSpan({ cls: 'gs-pill gs-pill-green' });

  // 卡组 dropdown — saved-preset shortcuts live top-right in the head, a different
  // mental model from the search / maturity / tags retrieval dimensions (which now
  // own the sidebar). Container only; populated by renderDeckDropdown(). The search
  // input + maturity control moved into the sidebar.
  const deckWrap = headR.createDiv({ cls: 'tg-deckdd' });

  // ── Page Body (tree + main) ──
  const page = container.createDiv({ cls: 'tg-page' });
  const treeSidebar = page.createEl('aside', { cls: 'tg-tree' });
  const main = page.createEl('section', { cls: 'tg-main' });

  // ── Sidebar scaffold — three coupled retrieval dimensions: 搜索 → 熟练度 → 标签.
  // Stable containers built once; only their bodies re-render, so the search input
  // keeps focus across keystrokes (it lives OUTSIDE any emptied region). The 全部卡片
  // anchor is gone — its job (reset to all) is the `sideClear` button, shown only
  // while a filter is active.
  const sideClear = treeSidebar.createDiv({ cls: 'tg-side-clear' });

  const searchSec = treeSidebar.createDiv({ cls: 'tg-side-sec' });
  searchSec.createDiv({ cls: 'tg-side-head', text: t('tags.side.search') });
  const searchBox = searchSec.createDiv({ cls: 'tg-side-search' });
  setHtml(searchBox, `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>`);
  const searchInput = searchBox.createEl('input', { placeholder: t('tags.search_placeholder') });
  const searchClearBtn = searchBox.createSpan({ cls: 'tg-side-search-x' });
  setHtml(searchClearBtn, `<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>`);
  const syncSearchBox = () => searchBox.classList.toggle('tg-side-search-filled', search.length > 0);
  searchInput.addEventListener('input', () => { search = searchInput.value; syncSearchBox(); refreshSidebar(); renderFilterBar(); renderMain(); });
  searchClearBtn.addEventListener('click', () => { search = ''; searchInput.value = ''; syncSearchBox(); refreshSidebar(); renderFilterBar(); renderMain(); });

  const matSec = treeSidebar.createDiv({ cls: 'tg-side-sec' });
  matSec.createDiv({ cls: 'tg-side-head', text: t('tags.drawer_maturity') });
  const matBody = matSec.createDiv({ cls: 'tg-md' });

  // The 标签 section is just a stable host; renderTree() empties + fills it with the
  // collapsible 标签 head + tag tree nodes (its head doubles as the section header).
  const tagSec = treeSidebar.createDiv({ cls: 'tg-side-sec' });

  // Off-canvas drawer plumbing — at ≤900 the sidebar (`.tg-tree`) becomes an
  // overlay toggled by the head's funnel button; `.tg-drawer-open` on `.tg-page`
  // slides it in. At wider widths the class is inert (CSS only off-canvases ≤900),
  // so no width detection is needed in JS.
  const scrim = page.createDiv({ cls: 'tg-drawer-scrim' });
  let drawerOpen = false;
  const setDrawer = (open: boolean) => {
    drawerOpen = open;
    page.classList.toggle('tg-drawer-open', open);
  };
  const closeDrawer = () => { if (drawerOpen) setDrawer(false); };

  // Funnel toggle — appended last so it sits at the right end of the head row.
  // Visible only ≤900 (CSS); wiring it here keeps setDrawer in scope.
  const drawerToggle = headR.createEl('button', { cls: 'tg-drawer-toggle' });
  setHtml(drawerToggle, `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>`);
  setTooltip(drawerToggle, t('tags.drawer_toggle'));
  drawerToggle.addEventListener('click', (e) => { e.stopPropagation(); setDrawer(!drawerOpen); });
  scrim.addEventListener('click', () => closeDrawer());

  // Deck dropdown open/close state (the menu lives in the head). Outside-click and
  // Escape close it; the button/menu stop propagation so inner clicks don't.
  let deckMenuOpen = false;
  const closeDeckMenu = () => {
    if (!deckMenuOpen) return;
    deckMenuOpen = false;
    deckWrap.classList.remove('tg-deckdd-open');
  };

  component.registerDomEvent(document, 'click', () => closeDeckMenu());
  component.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closeDrawer(); closeDeckMenu(); }
  });

  const toggleTag = (tag: string, multi: boolean) => {
    if (multi) {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        const topLevel = tag.split('/')[0];
        for (const t of [...selectedTags]) {
          if (t.split('/')[0] === topLevel) selectedTags.delete(t);
        }
        selectedTags.add(tag);
      }
    } else {
      selectedTags.clear();
      selectedTags.add(tag);
    }
    refreshSidebar();
    renderFilterBar();
    renderMain();
    // Single-select closes the drawer; multi-select keeps it open for more picks.
    if (!multi) closeDrawer();
  };

  const clearAll = () => {
    selectedTags.clear();
    search = '';
    searchInput.value = '';
    syncSearchBox();
    matSel.clear();
    ALL_MATURITY().forEach(m => matSel.add(m));
    appliedDeckId = null;
    refreshSidebar();
    renderFilterBar();
    renderMain();
    closeDrawer();
  };

  // applyDeck overwrites the current filter with a deck's saved one and re-renders.
  const applyDeck = (deck: CustomDeck) => {
    selectedTags.clear();
    for (const tg of deck.filter.tags) selectedTags.add(tg);
    search = deck.filter.search;
    searchInput.value = search;
    syncSearchBox();
    matSel.clear();
    const dm = normMaturity(deck.filter.maturity);
    (dm.length > 0 && dm.length < 3 ? dm : ALL_MATURITY()).forEach(m => matSel.add(m));
    appliedDeckId = deck.id;
    refreshSidebar();
    renderFilterBar();
    renderMain();
    closeDrawer();
  };

  // ── Maturity (sidebar distribution bar — multi-select) ──
  const toggleMat = (b: Maturity) => {
    if (matSel.has(b)) matSel.delete(b); else matSel.add(b);
    if (matSel.size === 0) ALL_MATURITY().forEach(m => matSel.add(m)); // empty ≡ all
    refreshSidebar();
    renderFilterBar();
    renderMain();
  };

  const renderMaturity = () => {
    matBody.empty();
    // Faceted counts: scoped to the OTHER two dimensions (search + tags), bucketed
    // by maturity. The maturity selection does NOT shrink its own counts — a
    // deselected bucket dims but still shows what re-adding it would bring back.
    const scope = ctx.store.getCardsByTags(selectedTags, search || undefined);
    const counts: Record<Maturity, number> = { new: 0, learning: 0, mature: 0 };
    for (const e of scope) counts[classifyMaturity(e.card)]++;
    const total = scope.length;

    const bar = matBody.createDiv({ cls: 'tg-md-bar' });
    for (const b of MATURITY_BUCKETS) {
      const seg = bar.createDiv({ cls: `tg-md-seg tg-md-seg-${b.id}${matSel.has(b.id) ? '' : ' tg-md-seg-off'}` });
      seg.style.flexGrow = String(counts[b.id]);
      if (counts[b.id] > 0) seg.setText(String(counts[b.id]));
      setTooltip(seg, t(MATURITY_CHIP_KEY[b.id]));
      seg.addEventListener('click', () => toggleMat(b.id));
    }

    const legend = matBody.createDiv({ cls: 'tg-md-legend' });
    for (const b of MATURITY_BUCKETS) {
      const li = legend.createDiv({ cls: `tg-md-leg tg-md-leg-${b.id}${matSel.has(b.id) ? '' : ' tg-md-leg-off'}` });
      li.createSpan({ cls: 'tg-md-leg-box' });
      li.createSpan({ cls: 'tg-md-leg-label', text: t(MATURITY_CHIP_KEY[b.id]) });
      li.addEventListener('click', () => toggleMat(b.id));
    }

    const ms = matFilterArr();
    const hit = ms.length === 0 ? total : scope.filter(e => ms.includes(classifyMaturity(e.card))).length;
    matBody.createDiv({ cls: 'tg-md-hit', text: t('tags.maturity_hit', { hit, total }) });
  };

  // ── Sidebar "清空" — replaces the old 全部卡片 anchor; shown only when a filter is active.
  const renderSideClear = () => {
    sideClear.empty();
    if (!hasActiveFilter()) { sideClear.style.display = 'none'; return; }
    sideClear.style.display = '';
    const btn = sideClear.createEl('button', { cls: 'tg-side-clearbtn' });
    setHtml(btn, `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`);
    btn.createSpan({ text: t('tags.clear_filters') });
    btn.addEventListener('click', () => clearAll());
  };

  // Refresh the three sidebar sections together. Called on any scope change so the
  // faceted maturity counts re-scope and the clear button toggles in/out.
  const refreshSidebar = () => {
    renderSideClear();
    renderMaturity();
    renderTree();
  };

  // ── 卡组 dropdown (head, top-right) ──
  const renderDeckDropdown = () => {
    deckWrap.empty();
    closeDeckMenu();
    const decks = getCustomDecks().sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    if (decks.length === 0) { deckWrap.style.display = 'none'; return; }
    deckWrap.style.display = '';

    const btn = deckWrap.createEl('button', { cls: 'tg-deckdd-btn' });
    setHtml(btn, `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`);
    btn.createSpan({ cls: 'tg-deckdd-label', text: t('decks.section_label') });
    const caret = btn.createSpan({ cls: 'tg-deckdd-caret' });
    setHtml(caret, `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>`);

    const menu = deckWrap.createDiv({ cls: 'tg-deckdd-menu' });
    menu.addEventListener('click', (e) => e.stopPropagation());

    // Populate fresh on each open so the active (源卡组) highlight reflects the
    // current filter without rebuilding the dropdown on every keystroke.
    const fillMenu = () => {
      menu.empty();
      const sourceDeck = findMatchingDeck(decks, currentFilter());
      menu.createDiv({ cls: 'tg-deckdd-head', text: t('decks.section_label') });
      for (const deck of decks) {
        const isOn = sourceDeck?.id === deck.id;
        const item = menu.createDiv({ cls: `tg-deckdd-item${isOn ? ' tg-deckdd-item-on' : ''}` });
        if (deck.icon) item.createSpan({ cls: 'tg-deckdd-icon', text: deck.icon });
        item.createSpan({ cls: 'tg-deckdd-name', text: deck.name });
        const dScope = ctx.store.getCardsByTags(new Set(deck.filter.tags), deck.filter.search || undefined);
        const dm = normMaturity(deck.filter.maturity);
        const n = (dm.length > 0 && dm.length < 3)
          ? dScope.filter(e => dm.includes(classifyMaturity(e.card))).length
          : dScope.length;
        item.createSpan({ cls: 'tg-deckdd-n gs-mono', text: String(n) });
        item.addEventListener('click', () => { closeDeckMenu(); applyDeck(deck); });
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const m = new Menu();
          m.addItem((it) => it.setTitle(t('decks.menu.edit')).setIcon('pencil').onClick(() => {
            new EditDeckModal(ctx.app, ctx.store, deck, () => { renderDeckDropdown(); renderFilterBar(); }).open();
          }));
          m.addSeparator();
          m.addItem((it) => it.setTitle(t('decks.menu.delete')).setIcon('trash').onClick(() => {
            confirmDeleteDeck(ctx.app, ctx.store, deck, () => {
              if (appliedDeckId === deck.id) appliedDeckId = null;
              renderDeckDropdown();
              renderFilterBar();
            });
          }));
          m.showAtMouseEvent(e);
        });
      }
      menu.createDiv({ cls: 'tg-deckdd-sep' });
      const manage = menu.createDiv({ cls: 'tg-deckdd-manage' });
      setHtml(manage, `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`);
      manage.createSpan({ text: t('decks.menu.manage_all') });
      manage.addEventListener('click', () => {
        closeDeckMenu();
        new DeckManageModal(ctx.app, ctx.store, () => { renderDeckDropdown(); renderFilterBar(); }).open();
      });
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deckMenuOpen = !deckMenuOpen;
      deckWrap.classList.toggle('tg-deckdd-open', deckMenuOpen);
      if (deckMenuOpen) fillMenu();
    });
  };

  // ── Filter Condition Bar ──
  const filterBarEl = main.createDiv({ cls: 'tg-filter-bar' });

  const renderFilterBar = () => {
    filterBarEl.empty();
    const hasFilters = selectedTags.size > 0 || search.length > 0 || matConstrained();
    if (!hasFilters) {
      filterBarEl.style.display = 'none';
      return;
    }
    filterBarEl.style.display = '';

    const needParens = selectedTags.size > 1 && search.length > 0;

    if (needParens) filterBarEl.createSpan({ cls: 'tg-filter-paren', text: '(' });

    for (const tag of selectedTags) {
      const chip = filterBarEl.createDiv({ cls: 'tg-filter-chip' });
      const label = '#' + (tag.split('/').pop()?.replace(/^#/, '') || tag);
      chip.createSpan({ cls: 'tg-filter-chip-label', text: label });
      chip.title = tag;
      const removeBtn = chip.createSpan({ cls: 'tg-filter-chip-x' });
      setHtml(removeBtn, `<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>`);
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedTags.delete(tag);
        refreshSidebar();
        renderFilterBar();
        renderMain();
      });

      if ([...selectedTags].indexOf(tag) < selectedTags.size - 1) {
        filterBarEl.createSpan({ cls: 'tg-filter-and', text: t('tags.filter.and') });
      }
    }

    if (needParens) filterBarEl.createSpan({ cls: 'tg-filter-paren', text: ')' });

    if (search.length > 0) {
      if (selectedTags.size > 0) {
        filterBarEl.createSpan({ cls: 'tg-filter-and', text: t('tags.filter.and') });
      }
      const chip = filterBarEl.createDiv({ cls: 'tg-filter-chip tg-filter-chip-search' });
      chip.createSpan({ cls: 'tg-filter-chip-label', text: `"${search}"` });
      const removeBtn = chip.createSpan({ cls: 'tg-filter-chip-x' });
      setHtml(removeBtn, `<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>`);
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        search = '';
        searchInput.value = '';
        syncSearchBox();
        refreshSidebar();
        renderFilterBar();
        renderMain();
      });
    }

    // Maturity is multi-select: one colored chip per lit bucket (only when
    // constrained, i.e. not all-three). The buckets are OR'd among themselves, so
    // an "AND" joins them to the tag/search group but not to each other.
    if (matConstrained()) {
      let firstMat = true;
      for (const b of MATURITY_BUCKETS) {
        if (!matSel.has(b.id)) continue;
        if (firstMat && (selectedTags.size > 0 || search.length > 0)) {
          filterBarEl.createSpan({ cls: 'tg-filter-and', text: t('tags.filter.and') });
        }
        firstMat = false;
        const chip = filterBarEl.createDiv({ cls: `tg-filter-chip tg-filter-chip-maturity tg-filter-chip-mat-${b.id}` });
        chip.createSpan({ cls: 'tg-filter-chip-label', text: t(MATURITY_CHIP_KEY[b.id]) });
        const removeBtn = chip.createSpan({ cls: 'tg-filter-chip-x' });
        setHtml(removeBtn, `<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l6 6M8 2l-6 6"/></svg>`);
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          matSel.delete(b.id);
          if (matSel.size === 0) ALL_MATURITY().forEach(m => matSel.add(m));
          refreshSidebar();
          renderFilterBar();
          renderMain();
        });
      }
    }

    const addBtn = filterBarEl.createEl('button', { cls: 'tg-filter-add' });
    setHtml(addBtn, `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 1v8M1 5h8"/></svg>`);
    addBtn.title = t('tags.add_filter');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagPicker(addBtn);
    });

    if (selectedTags.size === 1) {
      const tag = [...selectedTags][0];
      const acc = ctx.store.getAccuracyForTag(tag);
      if (acc !== null) {
        const pill = filterBarEl.createSpan({ cls: 'tg-bc-pill' });
        const tone = acc >= 85 ? 'green' : acc >= 70 ? 'gold' : 'clay';
        pill.createSpan({ cls: `tg-bc-acc tg-bc-acc-${tone}`, text: t('tags.accuracy_pill', { n: acc }) });
      }
    }

    // Trailing actions: save / overwrite / clear — wrapped together and pushed right
    const decks = getCustomDecks().sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const filter = currentFilter();
    const sourceDeck = findMatchingDeck(decks, filter);
    const activeFilter = hasActiveFilter();
    const appliedDeck = appliedDeckId ? decks.find(d => d.id === appliedDeckId) ?? null : null;
    const activeCount = selectedTags.size + (search.length > 0 ? 1 : 0) + (matConstrained() ? 1 : 0);

    const showSave = activeFilter && !sourceDeck;
    const showOverwrite = !!appliedDeck && !sourceDeck && activeFilter;
    const showClear = activeCount >= 2;

    if (showSave || showOverwrite || showClear) {
      const trailing = filterBarEl.createDiv({ cls: 'tg-filter-trailing' });

      if (showSave) {
        const saveBtn = trailing.createEl('button', { cls: 'tg-filter-action tg-filter-action-save', text: t('decks.save_btn') });
        saveBtn.addEventListener('click', () => {
          new SaveDeckModal(ctx.app, ctx.store, filter, (newDeck) => {
            appliedDeckId = newDeck.id;
            renderDeckDropdown();
            renderFilterBar();
          }).open();
        });
      }

      if (showOverwrite) {
        const ovBtn = trailing.createEl('button', { cls: 'tg-filter-action tg-filter-action-overwrite', text: t('decks.overwrite_btn', { name: appliedDeck!.name }) });
        ovBtn.addEventListener('click', async () => {
          const next = decks.map(d => d.id === appliedDeck!.id ? { ...d, filter } : d);
          await ctx.store.updateSettings({ customDecks: next });
          renderDeckDropdown();
          renderFilterBar();
        });
      }

      if (showClear) {
        const clearBtn = trailing.createEl('button', { cls: 'tg-filter-clear', text: t('tags.filter.clear') });
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearAll();
        });
      }
    }
  };

  // ── Tag Picker Dropdown ──
  let pickerEl: HTMLElement | null = null;

  const closeTagPicker = () => {
    if (pickerEl) { pickerEl.remove(); pickerEl = null; }
    document.removeEventListener('click', onDocClick);
  };

  const onDocClick = () => closeTagPicker();

  const openTagPicker = (anchor: HTMLElement) => {
    if (pickerEl) { closeTagPicker(); return; }

    pickerEl = filterBarEl.createDiv({ cls: 'tg-picker' });
    pickerEl.addEventListener('click', (e) => e.stopPropagation());

    const pickerInput = pickerEl.createEl('input', { cls: 'tg-picker-input', placeholder: t('tags.picker.placeholder') });
    const pickerList = pickerEl.createDiv({ cls: 'tg-picker-list' });

    const renderPickerList = (query: string) => {
      pickerList.empty();
      const q = query.toLowerCase();
      const matches = allTagPaths.filter((tag) => {
        if (selectedTags.has(tag)) return false;
        return q === '' || tag.toLowerCase().includes(q);
      });
      if (matches.length === 0) {
        pickerList.createDiv({ cls: 'tg-picker-empty', text: t('tags.picker.empty') });
        return;
      }
      for (const tag of matches.slice(0, 30)) {
        const item = pickerList.createDiv({ cls: 'tg-picker-item' });
        item.textContent = tag.replace(/^#/, '');
        item.addEventListener('click', () => {
          selectedTags.add(tag);
          closeTagPicker();
          refreshSidebar();
          renderFilterBar();
          renderMain();
        });
      }
    };

    renderPickerList('');
    pickerInput.addEventListener('input', () => renderPickerList(pickerInput.value));
    setTimeout(() => {
      pickerInput.focus();
      document.addEventListener('click', onDocClick);
    }, 0);
  };

  // ── Tree ──
  const chevronSvg = (open: boolean) =>
    `<svg width="9" height="9" viewBox="0 0 10 10" style="transform: rotate(${open ? 90 : 0}deg); transition: transform .15s"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // renderTree owns ONLY the 标签 section now (third retrieval dimension). 搜索 +
  // 熟练度 live in their own stable sections above; 卡组 moved to the head dropdown.
  const renderTree = () => {
    refreshTree();
    tagSec.empty();

    const settings = ctx.store.getSettings();
    const tagTreeCollapsed = settings.tagsSidebarTagTreeCollapsed ?? false;

    // Tag tree group — collapsible. Its head doubles as the "标签" section header.
    const tagGroup = tagSec.createDiv({ cls: 'tg-tag-tree-group' });
    const tagHead = tagGroup.createDiv({ cls: 'tg-tree-head tg-side-head tg-collapsible-head' });
    tagHead.createSpan({ cls: 'tg-tree-head-label', text: t('tags.side.tags') });
    const tagChevron = tagHead.createSpan({ cls: 'tg-tree-head-chevron' });
    setHtml(tagChevron, chevronSvg(!tagTreeCollapsed));
    tagHead.addEventListener('click', async () => {
      await ctx.store.updateSettings({ tagsSidebarTagTreeCollapsed: !tagTreeCollapsed });
      renderTree();
    });

    if (!tagTreeCollapsed) {
      for (const node of tree) {
        renderTreeNode(tagGroup, node, 0);
      }
    }
  };

  const renderTreeNode = (parent: HTMLElement, node: TagTreeNode, level: number) => {
    const has = node.children.length > 0;
    const isOpen = expanded[node.path] ?? false;
    const isSel = selectedTags.has(node.path);

    const row = parent.createDiv({ cls: `tg-tree-row${isSel ? ' tg-tree-row-on' : ''}` });
    row.setAttribute('data-level', String(level));
    row.style.paddingLeft = `${8 + level * 14}px`;

    const caret = row.createEl('button', { cls: 'tg-tree-caret' });
    if (has) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '9'); svg.setAttribute('height', '9'); svg.setAttribute('viewBox', '0 0 10 10');
      if (isOpen) svg.style.transform = 'rotate(90deg)';
      svg.style.transition = 'transform .15s';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3 1l4 4-4 4'); path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path); caret.appendChild(svg);
      caret.addEventListener('click', (e) => { e.stopPropagation(); expanded[node.path] = !expanded[node.path]; renderTree(); });
    } else {
      caret.createSpan({ cls: 'tg-tree-bullet' });
    }

    const nameBtn = row.createDiv({ cls: 'tg-tree-namebtn' });
    nameBtn.createSpan({ cls: 'tg-tree-name', text: node.name.replace(/^#/, '') });
    nameBtn.createSpan({ cls: 'tg-tree-n gs-mono', text: String(node.count) });
    row.addEventListener('click', (e) => {
      toggleTag(node.path, e.metaKey || e.ctrlKey);
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle(t('tag_rename.menu')).setIcon('pencil').onClick(() => {
          if (!ctx.store.getSettings().renameTagsInVault) {
            new Notice(t('tag_rename.disabled_notice'));
            return;
          }
          new RenameTagModal(
            ctx.app,
            ctx.store,
            stripHash(node.path),
            () => ctx.refreshTab(),
          ).open();
        });
      });
      menu.showAtMouseEvent(e);
    });

    if (has && isOpen) {
      for (const child of node.children) renderTreeNode(parent, child, level + 1);
    }
  };

  // ── Main content ──
  const renderMain = () => {
    while (main.children.length > 1) main.removeChild(main.lastChild!);

    let entries = ctx.store.getCardsByTags(selectedTags, search || undefined);
    const ms = matFilterArr();
    if (ms.length > 0) {
      entries = entries.filter((e) => ms.includes(classifyMaturity(e.card)));
    }
    const cards = sortCards(entries, sortField, sortDir);

    tagCountPill.textContent = t('tags.pill.count', { n: tree.length });
    matchPill.textContent = t('tags.pill.match', { n: cards.length });
    if (cards.length > 0) {
      cramBtn.style.display = '';
      cramN.textContent = String(cards.length);
      setTooltip(cramBtn, t('cram.start_btn', { n: cards.length }));
    } else {
      cramBtn.style.display = 'none';
    }

    const autoShowTags = ctx.store.getSettings().autoShowTags;
    const isAutoShowTag = selectedTags.size === 1
      && matchesAnyPrefix([...selectedTags][0], autoShowTags, true);
    let expandAll = false;
    const openRows = new Set<string>();

    if (isAutoShowTag) {
      const toggleBtn = filterBarEl.createEl('button', { cls: 'gs-pill tg-bc-toggle', text: t('tags.expand_all') });
      filterBarEl.style.display = '';
      toggleBtn.addEventListener('click', () => {
        expandAll = !expandAll;
        toggleBtn.textContent = expandAll ? t('tags.collapse') : t('tags.expand_all');
        toggleBtn.classList.toggle('gs-pill-green', expandAll);
        if (expandAll) {
          cards.forEach(c => openRows.add(c.id));
        } else {
          openRows.clear();
        }
        renderCards();
      });
    }

    const table = main.createDiv({ cls: 'tg-table' });

    const headRow = table.createDiv({ cls: 'tg-row tg-row-head' });
    const makeSortHead = (cls: string, field: SortField, label: string) => {
      const isActive = sortField === field;
      const el = headRow.createSpan({ cls: `${cls} tg-c-head-sortable${isActive ? ' tg-c-head-active' : ''}` });
      el.createSpan({ cls: 'tg-c-head-label', text: label });
      if (isActive) {
        el.createSpan({ cls: 'tg-sort-arrow', text: sortDir === 'asc' ? '↑' : '↓' });
      }
      el.addEventListener('click', () => {
        if (sortField === field) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = field;
          sortDir = 'asc';
        }
        renderFilterBar();
        renderMain();
      });
    };
    makeSortHead('tg-c-front', 'front', t('tags.col.question'));
    headRow.createSpan({ cls: 'tg-c-tags', text: t('tags.col.tags') });
    makeSortHead('tg-c-ef', 'ef', t('tags.col.ef'));
    makeSortHead('tg-c-due', 'due', t('tags.col.due'));

    if (cards.length === 0) {
      const empty = table.createDiv({ cls: 'tg-empty' });
      empty.createDiv({ cls: 'tg-empty-zh', text: t('tags.empty.match') });
      return;
    }

    const BATCH = 200;
    let shown = 0;

    const renderCards = (scrollTo?: string) => {
      table.style.paddingBottom = '';
      while (table.children.length > 1) table.removeChild(table.lastChild!);

      if (cards.length > BATCH) {
        const hint = table.createDiv({ cls: 'tg-load-hint' });
        hint.textContent = t('tags.load_hint', { shown: Math.min(shown + BATCH, cards.length), total: cards.length });
      }

      const slice = cards.slice(0, shown + BATCH);
      shown = slice.length;
      const loadPromises: Promise<void>[] = [];
      let scrollRow: HTMLElement | null = null;
      for (const entry of slice) {
        const selectTag = (tag: string, e: MouseEvent) => {
          toggleTag(tag, e.metaKey || e.ctrlKey);
        };
        const { row, loadPromise } = renderCardRow(table, entry, openRows, expandAll, renderCards, selectTag, ctx, component);
        if (loadPromise) loadPromises.push(loadPromise);
        if (scrollTo === entry.id) scrollRow = row;
      }
      if (scrollRow) {
        Promise.all(loadPromises).then(() => {
          requestAnimationFrame(() => scrollRowToOffset(scrollRow!, 50));
        });
      }

      if (shown < cards.length) {
        const more = table.createEl('button', { cls: 'tg-load-more', text: t('tags.load_more', { n: cards.length - shown }) });
        more.addEventListener('click', () => renderCards());
      }
    };
    renderCards();
  };

  renderDeckDropdown();
  syncSearchBox();
  refreshSidebar();
  renderFilterBar();
  renderMain();

  return () => component.unload();
}

function renderCardRow(
  parent: HTMLElement, entry: CardEntry,
  openRows: Set<string>, expandAll: boolean, rerender: (scrollTo?: string) => void,
  onSelectTag: (tag: string, e: MouseEvent) => void, ctx: TabContext,
  component: Component,
): { row: HTMLElement; loadPromise: Promise<void> | null } {
  const { id, card } = entry;
  const isOpen = openRows.has(id);
  const dueLabel = formatDue(card.due);
  const dueTone = card.due <= formatToday() ? 'clay' : 'mute';

  const row = parent.createDiv({ cls: `tg-row${isOpen ? ' tg-row-open' : ''}` });
  let loadPromise: Promise<void> | null = null;

  const mainDiv = row.createDiv({ cls: 'tg-row-main' });
  // Toggle on the whole row, not just the inner `.tg-row-main` (which is
  // `display: contents` and so leaves the row's padding/grid-gaps unclickable —
  // same gap-vs-hover-box bug fixed for the sidebar tag tree in 83bda0d). Clicks
  // inside the expanded answer/meta area (`.tg-row-back`) must not collapse the row.
  row.addEventListener('click', (e) => {
    if (expandAll) return;
    if ((e.target as HTMLElement).closest('.tg-row-back')) return;
    if (openRows.has(id)) {
      openRows.delete(id);
      rerender();
    } else {
      openRows.clear();
      openRows.add(id);
      rerender(id);
    }
  });

  const front = mainDiv.createSpan({ cls: 'tg-c-front' });
  const caretMini = front.createSpan({ cls: 'tg-caret-mini' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '9'); svg.setAttribute('height', '9'); svg.setAttribute('viewBox', '0 0 10 10');
  if (isOpen) svg.style.transform = 'rotate(90deg)';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 1l4 4-4 4'); path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path); caretMini.appendChild(svg);
  // NOTE: no `markdown-preview-view` here. The card-list row title is a compact
  // 2-line clamped preview, not a reading surface — carrying that class let theme/
  // reading-mode rules (padding, line-height, block spacing) bleed in and balloon
  // the row height. Reading-mode snippets (cloze, etc.) still reach the expanded
  // answer below and the review/cram/inline surfaces, which keep the class.
  const frontText = front.createSpan({ cls: 'tg-front-text' });
  setTooltip(frontText, card.blockTitle);
  MarkdownRenderer.render(ctx.app, card.blockTitle, frontText, card.file, component);

  const tagsDiv = mainDiv.createSpan({ cls: 'tg-c-tags' });
  for (const tag of card.tags) {
    const chip = tagsDiv.createEl('button', { cls: 'tg-tag-chip' });
    chip.textContent = (tag.split('/').pop() || '').replace(/^#/, '');
    chip.title = tag;
    chip.addEventListener('click', (e) => { e.stopPropagation(); onSelectTag(tag, e); });
  }

  mainDiv.createSpan({ cls: 'tg-c-ef gs-mono', text: card.ease.toFixed(2) });
  mainDiv.createSpan({ cls: `tg-c-due gs-mono tg-due-${dueTone}`, text: dueLabel });

  // Jump to source note — hover-revealed icon at the row end (single click; ctrl/cmd → new tab).
  const sourceBtn = mainDiv.createEl('button', { cls: 'tg-c-source' });
  setIcon(sourceBtn, 'arrow-up-right');
  setTooltip(sourceBtn, t('tags.row.open_source'));
  sourceBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); // don't toggle row expand
    const startLine = await ctx.cardManager.getBlockStartLine(card, id);
    await openCardSource(ctx.app, card.file, startLine, { newTab: e.ctrlKey || e.metaKey });
  });

  if (isOpen) {
    const back = row.createDiv({ cls: 'tg-row-back' });
    back.createDiv({ cls: 'tg-back-l', text: t('tags.row.answer') });
    // markdown-preview-view: mirror renderCardAnswer so reading-mode CSS snippets
    // (e.g. `.markdown-preview-view sub` cloze) reach this answer too. This row
    // renders inline rather than via renderCardAnswer (to keep the empty-content
    // placeholder), so the class is applied here directly.
    const answerEl = back.createDiv({ cls: 'tg-back-answer markdown-rendered markdown-preview-view' });
    loadPromise = ctx.cardManager.getBlockContent(card, id).then(async (content) => {
      if (!answerEl.isConnected) return;
      if (content) {
        await MarkdownRenderer.render(ctx.app, content, answerEl, card.file, component);
        bindFootnotePopovers(answerEl, component);
        bindAnswerLinks(answerEl, ctx.app, card.file, component);
      } else {
        answerEl.createSpan({ cls: 'gs-placeholder', text: t('tags.row.no_content') });
      }
    });
    const meta = back.createDiv({ cls: 'tg-back-meta' });
    setHtml(meta,
      `<span class="tg-meta-pair"><span class="tg-meta-l">${escapeHtml(t('tags.row.meta.id'))}</span><span class="gs-mono">${escapeHtml(id)}</span></span>` +
      `<span class="tg-meta-pair"><span class="tg-meta-l">${escapeHtml(t('tags.row.meta.reps'))}</span><span class="gs-mono">${card.reviewCount}</span></span>` +
      `<span class="tg-meta-pair"><span class="tg-meta-l">${escapeHtml(t('tags.row.meta.due'))}</span><span class="gs-mono">${escapeHtml(card.due)}</span></span>` +
      `<span class="tg-meta-pair"><span class="tg-meta-l">${escapeHtml(t('tags.row.meta.file'))}</span><span class="gs-mono">${escapeHtml(card.file)}</span></span>`);
  }
  return { row, loadPromise };
}

function sortCards(cards: CardEntry[], field: SortField, dir: SortDir): CardEntry[] {
  const mul = dir === 'asc' ? 1 : -1;
  const cmp = (a: CardEntry, b: CardEntry): number => {
    switch (field) {
      case 'front':
        return a.card.blockTitle.toLowerCase().localeCompare(b.card.blockTitle.toLowerCase());
      case 'ef':
        return a.card.ease - b.card.ease;
      case 'due':
        return a.card.due < b.card.due ? -1 : a.card.due > b.card.due ? 1 : 0;
      case 'created': {
        const ca = a.card.createdAt ?? '';
        const cb = b.card.createdAt ?? '';
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      }
    }
  };
  return [...cards].sort((a, b) => cmp(a, b) * mul);
}

function scrollRowToOffset(row: HTMLElement, topOffset: number): void {
  let scroller: HTMLElement | null = row.parentElement;
  while (scroller) {
    const oy = getComputedStyle(scroller).overflowY;
    if (oy === 'auto' || oy === 'scroll') break;
    scroller = scroller.parentElement;
  }
  if (!scroller) return;

  const needed = Math.max(0, scroller.clientHeight - topOffset - row.offsetHeight);
  scroller.style.paddingBottom = `${needed}px`;

  const rowTop = row.getBoundingClientRect().top;
  const containerTop = scroller.getBoundingClientRect().top;
  const diff = rowTop - containerTop - topOffset;
  scroller.scrollBy({ top: diff, behavior: 'smooth' });
}

function formatDue(due: string): string {
  const today = formatToday();
  if (due === today) return t('common.due_today');
  if (due < today) return t('common.due_overdue');
  const d1 = new Date(today), d2 = new Date(due);
  const days = Math.round((d2.getTime() - d1.getTime()) / 86400000);
  return `+${days}d`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
