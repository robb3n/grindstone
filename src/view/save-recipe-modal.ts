import { App, Modal } from 'obsidian';
import { SrsIntent, IntentRecipe } from '../card/types';
import { t, getLang, StringKey } from '../i18n';

const EMOJI_CHOICES = ['✍️', '🎯', '🌙', '☀️', '🚀', '🐢', '🎨', '🎵', '🧪', '🍵', '📔', '🎪'];

export class SaveRecipeModal extends Modal {
  private intent: SrsIntent;
  private onSave: (recipe: IntentRecipe) => void | Promise<void>;
  private selectedEmoji = '✍️';

  constructor(app: App, intent: SrsIntent, onSave: (recipe: IntentRecipe) => void | Promise<void>) {
    super(app);
    this.intent = intent;
    this.onSave = onSave;
  }

  onOpen(): void {
    this.modalEl.addClass('gs-save-recipe-modal');
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: t('settings.srs.recipe.save_title') });
    contentEl.createDiv({ cls: 'gs-recipe-modal-sub', text: t('settings.srs.recipe.save_sub') });

    // Emoji picker
    const emojiRow = contentEl.createDiv({ cls: 'gs-recipe-form-row' });
    emojiRow.createDiv({ cls: 'gs-recipe-form-label', text: t('settings.srs.recipe.icon') });
    const picker = emojiRow.createDiv({ cls: 'gs-recipe-emoji-picker' });
    const emojiBtns: HTMLButtonElement[] = [];
    for (const e of EMOJI_CHOICES) {
      const btn = picker.createEl('button', { cls: 'gs-recipe-emoji-btn', text: e });
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.selectedEmoji = e;
        emojiBtns.forEach(b => b.toggleClass('on', b === btn));
      });
      emojiBtns.push(btn);
    }
    emojiBtns[0].toggleClass('on', true);

    // Name
    const nameRow = contentEl.createDiv({ cls: 'gs-recipe-form-row' });
    nameRow.createDiv({ cls: 'gs-recipe-form-label', text: t('settings.srs.recipe.name') });
    const nameInput = nameRow.createEl('input', { cls: 'gs-recipe-form-input', type: 'text' });
    nameInput.placeholder = t('settings.srs.recipe.name_placeholder');
    nameInput.maxLength = 14;

    // Subtitle
    const subRow = contentEl.createDiv({ cls: 'gs-recipe-form-row' });
    subRow.createDiv({ cls: 'gs-recipe-form-label', text: t('settings.srs.recipe.sub') });
    const subInput = subRow.createEl('input', { cls: 'gs-recipe-form-input', type: 'text' });
    subInput.placeholder = t('settings.srs.recipe.sub_placeholder');
    subInput.maxLength = 10;

    // Intent summary
    const summaryRow = contentEl.createDiv({ cls: 'gs-recipe-form-row' });
    summaryRow.createDiv({ cls: 'gs-recipe-form-label', text: t('settings.srs.recipe.intent_summary') });
    const summary = summaryRow.createDiv({ cls: 'gs-recipe-intent-summary' });
    const rows: Array<{ k: 'intensity' | 'tolerance' | 'start' | 'goal'; label: string; val: string }> = [
      { k: 'intensity', label: t('settings.srs.intent.intensity'), val: t(`settings.srs.intent.intensity.${this.intent.intensity}` as StringKey) },
      { k: 'tolerance', label: t('settings.srs.intent.tolerance'), val: t(`settings.srs.intent.tolerance.${this.intent.tolerance}` as StringKey) },
      { k: 'start',     label: t('settings.srs.intent.start'),     val: t(`settings.srs.intent.start.${this.intent.start}` as StringKey) },
      { k: 'goal',      label: t('settings.srs.intent.goal'),      val: t(`settings.srs.intent.goal.${this.intent.goal}` as StringKey) },
    ];
    for (const r of rows) {
      const row = summary.createDiv({ cls: 'gs-recipe-intent-row' });
      row.createSpan({ text: r.label });
      row.createSpan({ cls: 'gs-recipe-intent-val', text: r.val });
    }

    // Actions
    const actions = contentEl.createDiv({ cls: 'gs-recipe-modal-actions' });
    const cancelBtn = actions.createEl('button', { cls: 'gs-btn', text: t('settings.srs.recipe.cancel') });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('settings.srs.recipe.save') });
    saveBtn.disabled = true;

    const updateSaveState = () => {
      saveBtn.disabled = nameInput.value.trim().length === 0;
    };
    nameInput.addEventListener('input', updateSaveState);

    saveBtn.addEventListener('click', async () => {
      const nm = nameInput.value.trim();
      if (!nm) return;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      const recipe: IntentRecipe = {
        id: `u-${Date.now()}`,
        ico: this.selectedEmoji,
        nm,
        sub: subInput.value.trim() || (getLang() === 'zh' ? '自定义' : 'Custom'),
        intent: { ...this.intent },
        builtin: false,
      };
      await this.onSave(recipe);
      this.close();
    });

    setTimeout(() => nameInput.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
