import { TabContext } from './types';
import { renderIntentEditor } from '../../settings/intent-editor';
import { renderIntentPreview, IntentPreviewHandle } from '../../settings/intent-preview';
import { DeckResetConfirmModal } from '../strategy-modals';
import { BUILTIN_INTENT_RECIPES, IntentRecipe, SrsIntent, DEFAULT_INTENT } from '../../card/types';
import { intentToParams } from '../../srs/intent';
import { t, getLang, StringKey } from '../../i18n';

export function renderStrategy(container: HTMLElement, ctx: TabContext): void {
  // ── Page head ──
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('nav.strategy') });

  const page = container.createDiv({ cls: 'gs-page' });

  // Tabs — same pill segmented control as the Review tab.
  type StrategyTabId = 'console' | 'deck';
  let activeTab: StrategyTabId = 'console';
  const tabs = page.createDiv({ cls: 'rv-tabs' });
  const sectionWrap = page.createDiv({ cls: 'rv-section-wrap' });

  const SECTIONS: { id: StrategyTabId; labelKey: StringKey }[] = [
    { id: 'console', labelKey: 'settings.srs.global' },
    { id: 'deck',    labelKey: 'settings.srs.per_deck' },
  ];

  const indicator = tabs.createSpan({ cls: 'rv-tab-ind' });
  const tabBtns: Partial<Record<StrategyTabId, HTMLButtonElement>> = {};

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
    if (activeTab === 'console') renderConsoleSubsection(sectionWrap, ctx);
    else renderDeckSubsection(sectionWrap, ctx);
  };

  tabs.addClass('rv-tabs-init');
  requestAnimationFrame(() => {
    positionIndicator();
    requestAnimationFrame(() => tabs.removeClass('rv-tabs-init'));
  });

  renderSection();
}

function renderConsoleSubsection(container: HTMLElement, ctx: TabContext): void {
  const settings = ctx.store.getSettings();
  const initialIntent: SrsIntent = { ...(settings.activeIntent ?? DEFAULT_INTENT) };
  const editorWrap = container.createDiv();
  const previewWrap = container.createDiv();
  const preview: IntentPreviewHandle = renderIntentPreview(previewWrap, { intent: initialIntent });

  renderIntentEditor(editorWrap, {
    app: ctx.app,
    intent: initialIntent,
    recipes: {
      userRecipes: settings.userIntentRecipes ?? [],
      recipeOrder: settings.recipeOrder ?? [],
      hiddenBuiltinRecipes: settings.hiddenBuiltinRecipes ?? [],
    },
    onChange: (intent, recipes) => {
      void ctx.store.updateSettings({
        activeIntent: intent,
        userIntentRecipes: recipes.userRecipes,
        recipeOrder: recipes.recipeOrder,
        hiddenBuiltinRecipes: recipes.hiddenBuiltinRecipes,
      });
      preview.update({ intent });
    },
  });
}

function renderDeckSubsection(container: HTMLElement, ctx: TabContext): void {
  renderDefaultStrategyRow(container, ctx);

  // ── Per-deck overrides ──
  const tree = ctx.store.getDeckTree();
  if (tree.length === 0) {
    container.createDiv({
      cls: 'gs-deck-strategy-empty',
      text: t('settings.srs.deck_empty'),
    });
    return;
  }

  const settings = ctx.store.getSettings();
  const userRecipes = settings.userIntentRecipes ?? [];
  const isZh = getLang() === 'zh';
  const recipeName = (r: { nm: string; nmEn?: string }): string => isZh ? r.nm : (r.nmEn ?? r.nm);
  const allOptions: Array<{ id: string; name: string }> = [
    { id: '__default__', name: t('settings.srs.default_preset') },
    ...visibleRecipes(settings).map(r => ({ id: r.id, name: recipeName(r) })),
  ];

  const list = container.createDiv({ cls: 'gs-deck-strategy-list' });

  for (const deck of tree) {
    const overrides = ctx.store.getSettings().deckSrsOverrides ?? {};
    const currentValue = overrides[deck.fullTag];
    const rawId = currentValue === undefined
      ? '__default__'
      : (typeof currentValue === 'string' ? currentValue : '__default__');
    const currentId = allOptions.some(o => o.id === rawId) ? rawId : '__default__';

    const row = list.createDiv({ cls: 'gs-deck-strategy-row' });
    const meta = row.createDiv({ cls: 'gs-deck-strategy-meta' });
    meta.createSpan({ cls: 'gs-deck-strategy-name', text: '#' + deck.fullTag });
    meta.createSpan({
      cls: 'gs-deck-strategy-count gs-mono',
      text: `${deck.count} ${isZh ? '张' : 'cards'}`,
    });

    const select = row.createEl('select', { cls: 'gs-deck-strategy-select dropdown' });
    for (const opt of allOptions) {
      const o = select.createEl('option', { value: opt.id, text: opt.name });
      if (opt.id === currentId) o.selected = true;
    }

    select.addEventListener('change', () => {
      const newId = select.value;
      if (newId === currentId) return;

      const targetName = allOptions.find(o => o.id === newId)?.name ?? t('settings.srs.default_preset');
      const allRecipes = [...BUILTIN_INTENT_RECIPES, ...userRecipes];
      const matchedRecipe = allRecipes.find(r => r.id === newId);
      const resolvedParams = newId === '__default__'
        ? ctx.store.getSrsParams()
        : (matchedRecipe ? intentToParams(matchedRecipe.intent) : ctx.store.getSrsParams());

      select.value = currentId;

      new DeckResetConfirmModal(
        ctx.app,
        deck.fullTag,
        targetName,
        resolvedParams,
        ctx.store,
        () => ctx.refreshTab(),
      ).open();
    });
  }
}

function renderDefaultStrategyRow(container: HTMLElement, ctx: TabContext): void {
  const settings = ctx.store.getSettings();
  const isZh = getLang() === 'zh';
  const recipeName = (r: IntentRecipe): string => isZh ? r.nm : (r.nmEn ?? r.nm);
  const recipes = visibleRecipes(settings);

  const row = container.createDiv({ cls: 'gs-default-strategy-row' });
  const meta = row.createDiv({ cls: 'gs-default-strategy-meta' });
  meta.createSpan({ cls: 'gs-default-strategy-label', text: t('settings.srs.default_strategy') });
  meta.createSpan({ cls: 'gs-default-strategy-sub', text: t('settings.srs.default_strategy_sub') });

  const select = row.createEl('select', { cls: 'gs-deck-strategy-select dropdown' });
  const noneOpt = select.createEl('option', {
    value: '',
    text: t('settings.srs.default_strategy_none'),
  });
  if (!settings.defaultRecipeId) noneOpt.selected = true;
  for (const r of recipes) {
    const opt = select.createEl('option', { value: r.id, text: recipeName(r) });
    if (settings.defaultRecipeId === r.id) opt.selected = true;
  }

  select.addEventListener('change', () => {
    const v = select.value;
    void ctx.store.updateSettings({ defaultRecipeId: v === '' ? undefined : v });
  });
}

function visibleRecipes(settings: { userIntentRecipes?: IntentRecipe[]; recipeOrder?: string[]; hiddenBuiltinRecipes?: string[] }): IntentRecipe[] {
  const hidden = new Set(settings.hiddenBuiltinRecipes ?? []);
  const visible: IntentRecipe[] = [
    ...BUILTIN_INTENT_RECIPES.filter(r => !hidden.has(r.id)),
    ...(settings.userIntentRecipes ?? []),
  ];
  const order = settings.recipeOrder ?? [];
  if (order.length === 0) return visible;
  const byId = new Map(visible.map(r => [r.id, r]));
  const seen = new Set<string>();
  const result: IntentRecipe[] = [];
  for (const id of order) {
    const r = byId.get(id);
    if (r && !seen.has(id)) {
      result.push(r);
      seen.add(id);
    }
  }
  for (const r of visible) {
    if (!seen.has(r.id)) result.push(r);
  }
  return result;
}
