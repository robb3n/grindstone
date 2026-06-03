import { App, Modal } from 'obsidian';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { BUILTIN_PRESETS, SrsPreset, DeckResetMode, SrsParams, BUILTIN_INTENT_RECIPES } from '../card/types';
import { t, getLang, StringKey } from '../i18n';

// ── Reset Confirmation Modal ──
//
// Triggered when assigning a non-default strategy to a deck — prompts the user
// to choose how existing cards under that deck should adapt to new SRS params.

export class DeckResetConfirmModal extends Modal {
  private deckTag: string;
  private strategyName: string;
  private newParams: SrsParams;
  private gsStore: GrindstoneStore;
  private selectedMode: DeckResetMode = 'gradual';
  private onDone?: () => void;

  constructor(
    app: App,
    deckTag: string,
    strategyName: string,
    newParams: SrsParams,
    gsStore: GrindstoneStore,
    onDone?: () => void,
  ) {
    super(app);
    this.deckTag = deckTag;
    this.strategyName = strategyName;
    this.newParams = newParams;
    this.gsStore = gsStore;
    this.onDone = onDone;
  }

  onOpen(): void {
    this.modalEl.addClass('dk-reset-modal');
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: t('strategy.switch_title', { name: this.strategyName }) });
    contentEl.createDiv({
      cls: 'dk-reset-desc',
      text: t('strategy.body', { tag: this.deckTag, name: this.strategyName }),
    });

    const options: Array<{ mode: DeckResetMode; labelKey: StringKey; descKey: StringKey; descParams?: Record<string, string | number>; warningKey?: StringKey }> = [
      {
        mode: 'gradual',
        labelKey: 'strategy.gradual',
        descKey:  'strategy.gradual_desc',
      },
      {
        mode: 'reset-ease',
        labelKey: 'strategy.reset_ease',
        descKey:  'strategy.reset_ease_desc',
        descParams: { ease: this.newParams.initialEase },
      },
      {
        mode: 'full-reset',
        labelKey: 'strategy.full_reset',
        descKey:  'strategy.full_reset_desc',
        warningKey: 'strategy.full_reset_warn',
      },
    ];

    const optionsWrap = contentEl.createDiv({ cls: 'dk-reset-options' });
    for (const opt of options) {
      const el = optionsWrap.createDiv({
        cls: `dk-reset-option${opt.mode === this.selectedMode ? ' dk-reset-option-active' : ''}`,
      });
      const header = el.createDiv({ cls: 'dk-reset-option-h' });
      const radio = header.createSpan({ cls: 'dk-reset-radio' });
      if (opt.mode === this.selectedMode) radio.addClass('dk-reset-radio-on');
      header.createSpan({ cls: 'dk-reset-option-zh', text: t(opt.labelKey) });
      el.createDiv({ cls: 'dk-reset-option-desc', text: t(opt.descKey, opt.descParams) });
      if (opt.warningKey) {
        el.createDiv({ cls: 'dk-reset-warning', text: `⚠ ${t(opt.warningKey)}` });
      }

      el.addEventListener('click', () => {
        this.selectedMode = opt.mode;
        optionsWrap.querySelectorAll('.dk-reset-option').forEach(e => e.removeClass('dk-reset-option-active'));
        optionsWrap.querySelectorAll('.dk-reset-radio').forEach(e => e.removeClass('dk-reset-radio-on'));
        el.addClass('dk-reset-option-active');
        radio.addClass('dk-reset-radio-on');
      });
    }

    const actions = contentEl.createDiv({ cls: 'dk-reset-actions' });
    const cancelBtn = actions.createEl('button', { cls: 'gs-btn', text: t('strategy.cancel') });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('strategy.confirm') });
    confirmBtn.addEventListener('click', async () => {
      // Match the display name back to a preset by either localized name. The
      // caller passes whatever it rendered (zh or en), so we accept both.
      const presetValue = this.isGlobalDefault(this.strategyName) ? null : this.findPresetId();
      await this.gsStore.setDeckStrategy(this.deckTag, presetValue);
      await this.gsStore.resetDeckCards(this.deckTag, this.selectedMode, this.newParams);
      this.close();
      this.onDone?.();
    });
  }

  private isGlobalDefault(name: string): boolean {
    return name === t('srs.global_default') || name === '全局默认' || name === 'Global default';
  }

  private findPresetId(): string | null {
    const isZh = getLang() === 'zh';
    const settings = this.gsStore.getSettings();

    const recipes = [...BUILTIN_INTENT_RECIPES, ...(settings.userIntentRecipes ?? [])];
    const recipeMatch = recipes.find(r => (isZh ? r.nm : (r.nmEn ?? r.nm)) === this.strategyName);
    if (recipeMatch) return recipeMatch.id;

    const allPresets: SrsPreset[] = [
      ...BUILTIN_PRESETS,
      ...(settings.customPresets ?? []),
    ];
    return allPresets.find(p => (isZh ? p.name : p.nameEn) === this.strategyName)?.id ?? null;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
