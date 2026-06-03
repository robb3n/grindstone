import { App, Modal } from 'obsidian';
import { DataStore } from '../storage/data-store';
import { t, setLang, getLang, Lang, StringKey } from '../i18n';

type WriteMode = 'readonly' | 'ids' | 'ids-stars';

interface ModeOption {
  mode: WriteMode;
  labelKey: StringKey;
  descKey: StringKey;
  warningKey?: StringKey;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: 'readonly',
    labelKey: 'onboarding.mode.readonly',
    descKey:  'onboarding.mode.readonly_desc',
    warningKey: 'onboarding.mode.readonly_warn',
  },
  {
    mode: 'ids',
    labelKey: 'onboarding.mode.ids',
    descKey:  'onboarding.mode.ids_desc',
  },
  {
    mode: 'ids-stars',
    labelKey: 'onboarding.mode.ids_stars',
    descKey:  'onboarding.mode.ids_stars_desc',
  },
];

export class OnboardingModal extends Modal {
  private triggerTag = '#grind';
  private mode: WriteMode = 'ids';
  private finished = false;

  constructor(
    app: App,
    private store: DataStore,
    /** Called once with true if user accepted, false if they dismissed (X / Esc / click outside). */
    private onFinish: (accepted: boolean) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('gs-onboarding-modal');
    this.renderContent();
  }

  private renderContent(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Language switcher — sits above the header since settings.language doesn't
    // exist yet at onboarding time.
    const langRow = contentEl.createDiv({ cls: 'gs-ob-lang-row' });
    langRow.createSpan({ cls: 'gs-ob-lang-label', text: t('onboarding.lang_label') });
    const langSelect = langRow.createEl('select', { cls: 'dropdown' });
    for (const [lang, label] of [['zh', '中文'], ['en', 'English']] as Array<[Lang, string]>) {
      const opt = langSelect.createEl('option', { value: lang, text: label });
      if (getLang() === lang) opt.selected = true;
    }
    langSelect.addEventListener('change', () => {
      const next = langSelect.value as Lang;
      if (getLang() === next) return;
      setLang(next);
      // Re-render so the rest of the modal reflects the new language immediately.
      this.renderContent();
    });

    // Header
    const head = contentEl.createDiv({ cls: 'gs-ob-head' });
    head.createEl('h2', { cls: 'gs-ob-title', text: t('onboarding.welcome_title') });
    head.createEl('p', { cls: 'gs-ob-sub', text: t('onboarding.welcome_sub') });

    // ── Section 1: trigger tag ──
    const sec1 = contentEl.createDiv({ cls: 'gs-ob-section' });
    const sec1H = sec1.createDiv({ cls: 'gs-ob-section-h' });
    sec1H.createSpan({ cls: 'gs-ob-section-zh', text: t('onboarding.trigger_tag') });

    const tagInput = sec1.createEl('input', { cls: 'gs-ob-input', type: 'text' });
    tagInput.value = this.triggerTag;
    tagInput.placeholder = '#grind';
    tagInput.addEventListener('input', () => {
      this.triggerTag = tagInput.value.trim();
    });

    sec1.createDiv({
      cls: 'gs-ob-hint',
      text: t('onboarding.trigger_hint'),
    });

    // ── Section 2: write mode ──
    const sec2 = contentEl.createDiv({ cls: 'gs-ob-section' });
    const sec2H = sec2.createDiv({ cls: 'gs-ob-section-h' });
    sec2H.createSpan({ cls: 'gs-ob-section-zh', text: t('onboarding.writeback') });

    sec2.createDiv({
      cls: 'gs-ob-hint',
      text: t('onboarding.writeback_hint'),
    });

    const optionsWrap = sec2.createDiv({ cls: 'gs-ob-options' });
    for (const opt of MODE_OPTIONS) {
      const el = optionsWrap.createDiv({
        cls: `gs-ob-option${opt.mode === this.mode ? ' gs-ob-option-active' : ''}`,
        attr: { 'data-mode': opt.mode },
      });
      const header = el.createDiv({ cls: 'gs-ob-option-h' });
      const radio = header.createSpan({ cls: 'gs-ob-radio' });
      if (opt.mode === this.mode) radio.addClass('gs-ob-radio-on');
      header.createSpan({ cls: 'gs-ob-option-zh', text: t(opt.labelKey) });
      if (opt.mode === 'ids') {
        header.createSpan({ cls: 'gs-ob-option-rec', text: t('onboarding.recommended') });
      }
      el.createDiv({ cls: 'gs-ob-option-desc', text: t(opt.descKey) });
      if (opt.warningKey) {
        el.createDiv({ cls: 'gs-ob-warning', text: `⚠ ${t(opt.warningKey)}` });
      }

      el.addEventListener('click', () => {
        this.mode = opt.mode;
        optionsWrap.querySelectorAll('.gs-ob-option').forEach(e => e.removeClass('gs-ob-option-active'));
        optionsWrap.querySelectorAll('.gs-ob-radio').forEach(e => e.removeClass('gs-ob-radio-on'));
        el.addClass('gs-ob-option-active');
        radio.addClass('gs-ob-radio-on');
      });
    }

    // ── Actions ──
    const actions = contentEl.createDiv({ cls: 'gs-ob-actions' });
    const startBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('onboarding.start') });
    startBtn.addEventListener('click', () => this.finish());
  }

  private async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;

    const triggerTags = this.triggerTag.length > 0 ? [this.triggerTag] : ['#grind'];
    // Persist the language the user just confirmed (defaults to detected system
    // lang via getLang()).
    await this.store.updateSettings({
      triggerTags,
      embedCardIds: this.mode !== 'readonly',
      writeStarsBack: this.mode === 'ids-stars',
      language: getLang(),
      _onboardingDone: true,
    });
    this.close();
    await this.onFinish(true);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.finished) {
      this.finished = true;
      window.setTimeout(() => { void this.onFinish(false); }, 0);
    }
  }
}
