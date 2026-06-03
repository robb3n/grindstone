import { App, Modal } from 'obsidian';
import { SrsIntent, IntentRecipe, BUILTIN_INTENT_RECIPES } from '../card/types';
import { SaveRecipeModal } from '../view/save-recipe-modal';
import { t, getLang, StringKey } from '../i18n';

export interface RecipesState {
  userRecipes: IntentRecipe[];
  recipeOrder: string[];
  hiddenBuiltinRecipes: string[];
}

export interface IntentEditorOptions {
  app: App;
  intent: SrsIntent;
  recipes: RecipesState;
  onChange: (intent: SrsIntent, recipes: RecipesState) => void;
  /** Fired after recipes (user list / order / hidden) change. Strategy uses this
   *  to re-render the per-deck dropdown so newly added/removed recipes show up. */
  onRecipesChange?: (recipes: RecipesState) => void;
}

export interface IntentEditorHandle {
  detach(): void;
}

export function renderIntentEditor(container: HTMLElement, opts: IntentEditorOptions): IntentEditorHandle {
  const isZh = getLang() === 'zh';
  const intent: SrsIntent = { ...opts.intent };
  const recipes: RecipesState = {
    userRecipes: [...opts.recipes.userRecipes],
    recipeOrder: [...opts.recipes.recipeOrder],
    hiddenBuiltinRecipes: [...opts.recipes.hiddenBuiltinRecipes],
  };

  const snapshotRecipes = (): RecipesState => ({
    userRecipes: recipes.userRecipes.map(r => ({ ...r })),
    recipeOrder: [...recipes.recipeOrder],
    hiddenBuiltinRecipes: [...recipes.hiddenBuiltinRecipes],
  });

  const notify = (): void => {
    opts.onChange({ ...intent }, snapshotRecipes());
  };

  const notifyRecipesChanged = (): void => {
    opts.onRecipesChange?.(snapshotRecipes());
  };

  // ── Intent grid ──
  const intentGrid = container.createDiv({ cls: 'gs-intent-grid' });

  const intCard = intentGrid.createDiv({ cls: 'gs-intent-card' });
  const intH = intCard.createDiv({ cls: 'gs-intent-h' });
  intH.createSpan({ cls: 'gs-intent-label', text: t('settings.srs.intent.intensity') });
  const intValEl = intH.createSpan({ cls: 'gs-intent-val' });
  const intPill = intCard.createDiv({ cls: 'gs-slider-pill' });
  const intHot = intPill.createDiv({ cls: 'gs-slider-pill-hot' });
  const intTicks = intPill.createDiv({ cls: 'gs-slider-pill-ticks' });
  const intDots: HTMLElement[] = [];
  for (let i = 1; i <= 5; i++) {
    const btn = intHot.createEl('button', { cls: 'gs-slider-pill-btn' });
    const captured = i as 1 | 2 | 3 | 4 | 5;
    btn.addEventListener('click', () => apply({ intensity: captured }));
    intDots.push(intTicks.createSpan());
  }

  const buildSeg = <K extends 'tolerance' | 'start' | 'goal'>(
    key: K,
    options: readonly SrsIntent[K][],
  ): { valEl: HTMLElement; btns: HTMLButtonElement[]; segs: HTMLElement } => {
    const card = intentGrid.createDiv({ cls: 'gs-intent-card' });
    const h = card.createDiv({ cls: 'gs-intent-h' });
    h.createSpan({ cls: 'gs-intent-label', text: t(`settings.srs.intent.${key}` as StringKey) });
    const valEl = h.createSpan({ cls: 'gs-intent-val' });
    const segs = card.createDiv({ cls: 'gs-segs' });
    segs.style.setProperty('--gs-seg-n', String(options.length));
    segs.createDiv({ cls: 'gs-seg-thumb' });
    const btns: HTMLButtonElement[] = [];
    for (const o of options) {
      const btn = segs.createEl('button', { cls: 'gs-seg-btn', text: t(`settings.srs.intent.${key}.${o}` as StringKey) });
      btn.addEventListener('click', () => apply({ [key]: o } as Partial<SrsIntent>));
      btns.push(btn);
    }
    return { valEl, btns, segs };
  };

  const tolCtl = buildSeg('tolerance', ['strict', 'std', 'lenient'] as const);
  const stCtl  = buildSeg('start',     ['dense', 'std', 'spaced'] as const);
  const glCtl  = buildSeg('goal',      ['sprint', 'longterm'] as const);

  // ── Recipes block ──
  const recipesWrap = container.createDiv({ cls: 'gs-recipes' });
  const recipesH = recipesWrap.createDiv({ cls: 'gs-recipes-h' });
  const recipesHLeft = recipesH.createDiv({ cls: 'gs-recipes-h-l' });
  recipesHLeft.createSpan({ cls: 'gs-recipes-label', text: t('settings.srs.recipes') });
  recipesHLeft.createSpan({ cls: 'gs-recipes-hint', text: t('settings.srs.recipes.hint') });
  const resetBtn = recipesH.createEl('button', {
    cls: 'gs-recipes-reset',
    text: t('settings.srs.recipes.reset'),
  });
  resetBtn.setAttribute('aria-label', t('settings.srs.recipes.reset_aria'));
  resetBtn.addEventListener('click', () => {
    recipes.recipeOrder = [];
    recipes.hiddenBuiltinRecipes = [];
    notify();
    notifyRecipesChanged();
    renderRecipes();
  });

  // Strip + add card live in a row so the add card stays at the end.
  const recipeRow = recipesWrap.createDiv({ cls: 'gs-recipe-row' });
  const recipeStrip = recipeRow.createDiv({ cls: 'gs-recipe-strip' });
  const addCard = recipeRow.createDiv({ cls: 'gs-recipe-add' });
  addCard.createDiv({ cls: 'gs-recipe-add-plus', text: '＋' });
  addCard.createDiv({ cls: 'gs-recipe-add-lbl', text: t('settings.srs.recipe.add') });
  addCard.createDiv({ cls: 'gs-recipe-add-sub', text: t('settings.srs.recipe.add_hint') });
  addCard.addEventListener('click', () => {
    new SaveRecipeModal(opts.app, { ...intent }, async (recipe) => {
      recipes.userRecipes.push(recipe);
      if (recipes.recipeOrder.length > 0) recipes.recipeOrder.push(recipe.id);
      notify();
      notifyRecipesChanged();
      renderRecipes();
    }).open();
  });

  const renderIntentLabels = (): void => {
    intValEl.textContent = t(`settings.srs.intent.intensity.${intent.intensity}` as StringKey);
    tolCtl.valEl.textContent = t(`settings.srs.intent.tolerance.${intent.tolerance}` as StringKey);
    stCtl.valEl.textContent  = t(`settings.srs.intent.start.${intent.start}` as StringKey);
    glCtl.valEl.textContent  = t(`settings.srs.intent.goal.${intent.goal}` as StringKey);
    intDots.forEach((d, i) => d.toggleClass('on', i < intent.intensity));
    const tolOpts = ['strict', 'std', 'lenient'] as const;
    const tolIdx = tolOpts.indexOf(intent.tolerance);
    tolCtl.btns.forEach((b, i) => b.toggleClass('on', i === tolIdx));
    tolCtl.segs.style.setProperty('--gs-seg-i', String(Math.max(0, tolIdx)));
    const stOpts = ['dense', 'std', 'spaced'] as const;
    const stIdx = stOpts.indexOf(intent.start);
    stCtl.btns.forEach((b, i) => b.toggleClass('on', i === stIdx));
    stCtl.segs.style.setProperty('--gs-seg-i', String(Math.max(0, stIdx)));
    const glOpts = ['sprint', 'longterm'] as const;
    const glIdx = glOpts.indexOf(intent.goal);
    glCtl.btns.forEach((b, i) => b.toggleClass('on', i === glIdx));
    glCtl.segs.style.setProperty('--gs-seg-i', String(Math.max(0, glIdx)));
  };

  // Build the ordered list of visible recipes from recipeOrder + tail fallback.
  const orderedRecipes = (): IntentRecipe[] => {
    const visible: IntentRecipe[] = [
      ...BUILTIN_INTENT_RECIPES.filter(r => !recipes.hiddenBuiltinRecipes.includes(r.id)),
      ...recipes.userRecipes,
    ];
    const byId = new Map(visible.map(r => [r.id, r]));
    const seen = new Set<string>();
    const result: IntentRecipe[] = [];
    for (const id of recipes.recipeOrder) {
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
  };

  let dragId: string | null = null;

  const reorder = (fromId: string, targetId: string, before: boolean): void => {
    // Seed recipeOrder with the current visible order so partial orders work.
    if (recipes.recipeOrder.length === 0) {
      recipes.recipeOrder = orderedRecipes().map(r => r.id);
    } else {
      const known = new Set(recipes.recipeOrder);
      for (const r of orderedRecipes()) {
        if (!known.has(r.id)) recipes.recipeOrder.push(r.id);
      }
    }
    const order = recipes.recipeOrder.filter(id => id !== fromId);
    const targetIdx = order.indexOf(targetId);
    if (targetIdx < 0) return;
    order.splice(before ? targetIdx : targetIdx + 1, 0, fromId);
    recipes.recipeOrder = order;
    notify();
    notifyRecipesChanged();
    renderRecipes();
  };

  const renderRecipes = (): void => {
    recipeStrip.empty();
    const list = orderedRecipes();
    for (const rec of list) {
      const card = recipeStrip.createDiv({
        cls: 'gs-recipe' + (rec.builtin ? '' : ' gs-recipe-user'),
      });
      card.setAttribute('data-recipe-id', rec.id);
      card.setAttribute('draggable', 'true');
      card.createDiv({ cls: 'gs-recipe-ico', text: rec.ico });
      card.createDiv({ cls: 'gs-recipe-nm', text: isZh ? rec.nm : (rec.nmEn ?? rec.nm) });
      card.createDiv({ cls: 'gs-recipe-sub', text: isZh ? rec.sub : (rec.subEn ?? rec.sub) });
      const matches =
        rec.intent.intensity === intent.intensity &&
        rec.intent.tolerance === intent.tolerance &&
        rec.intent.start === intent.start &&
        rec.intent.goal === intent.goal;
      card.toggleClass('gs-recipe-on', matches);
      card.addEventListener('click', () => apply(rec.intent));

      const del = card.createEl('button', { cls: 'gs-recipe-del', text: '×' });
      del.setAttribute('aria-label', t('settings.srs.recipe.delete_title'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (rec.builtin) {
          new ConfirmDeleteBuiltinModal(opts.app, isZh ? rec.nm : (rec.nmEn ?? rec.nm), () => {
            if (!recipes.hiddenBuiltinRecipes.includes(rec.id)) {
              recipes.hiddenBuiltinRecipes.push(rec.id);
            }
            recipes.recipeOrder = recipes.recipeOrder.filter(id => id !== rec.id);
            notify();
            notifyRecipesChanged();
            renderRecipes();
          }).open();
        } else {
          recipes.userRecipes = recipes.userRecipes.filter(r => r.id !== rec.id);
          recipes.recipeOrder = recipes.recipeOrder.filter(id => id !== rec.id);
          notify();
          notifyRecipesChanged();
          renderRecipes();
        }
      });

      card.addEventListener('dragstart', (ev) => {
        dragId = rec.id;
        card.addClass('gs-recipe-dragging');
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', rec.id);
        }
      });
      card.addEventListener('dragend', () => {
        dragId = null;
        recipeStrip.querySelectorAll('.gs-recipe-dragging').forEach(el => el.removeClass('gs-recipe-dragging'));
        recipeStrip.querySelectorAll('.gs-recipe-drop-before, .gs-recipe-drop-after').forEach(el => {
          el.removeClass('gs-recipe-drop-before');
          el.removeClass('gs-recipe-drop-after');
        });
      });
      card.addEventListener('dragover', (ev) => {
        if (!dragId || dragId === rec.id) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        const rect = card.getBoundingClientRect();
        const before = (ev.clientX - rect.left) < rect.width / 2;
        card.toggleClass('gs-recipe-drop-before', before);
        card.toggleClass('gs-recipe-drop-after', !before);
      });
      card.addEventListener('dragleave', () => {
        card.removeClass('gs-recipe-drop-before');
        card.removeClass('gs-recipe-drop-after');
      });
      card.addEventListener('drop', (ev) => {
        if (!dragId || dragId === rec.id) return;
        ev.preventDefault();
        const rect = card.getBoundingClientRect();
        const before = (ev.clientX - rect.left) < rect.width / 2;
        reorder(dragId, rec.id, before);
        dragId = null;
      });
    }
  };

  const apply = (patch: Partial<SrsIntent>): void => {
    Object.assign(intent, patch);
    renderIntentLabels();
    renderRecipes();
    notify();
  };

  renderIntentLabels();
  renderRecipes();

  return {
    detach(): void {
      container.empty();
    },
  };
}

class ConfirmDeleteBuiltinModal extends Modal {
  private name: string;
  private onConfirm: () => void;

  constructor(app: App, name: string, onConfirm: () => void) {
    super(app);
    this.name = name;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.modalEl.addClass('gs-recipe-confirm-modal');
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', {
      text: t('settings.srs.recipes.delete_builtin_title', { name: this.name }),
    });
    contentEl.createDiv({
      cls: 'gs-recipe-confirm-body',
      text: t('settings.srs.recipes.delete_builtin_body'),
    });

    const actions = contentEl.createDiv({ cls: 'gs-recipe-confirm-actions' });
    const cancelBtn = actions.createEl('button', {
      cls: 'gs-btn',
      text: t('settings.srs.recipes.delete_cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = actions.createEl('button', {
      cls: 'gs-btn gs-btn-danger',
      text: t('settings.srs.recipes.delete_confirm'),
    });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
