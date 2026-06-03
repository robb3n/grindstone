import { App, Modal, Notice } from 'obsidian';
import { t } from '../i18n';

export class ResetLearningDataModal extends Modal {
  private cardCount: number;
  private logCount: number;
  private onConfirm: () => Promise<void>;

  constructor(app: App, cardCount: number, logCount: number, onConfirm: () => Promise<void>) {
    super(app);
    this.cardCount = cardCount;
    this.logCount = logCount;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.modalEl.addClass('gs-reset-modal');
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: t('settings.reset.modal_title') });

    const body = contentEl.createDiv({ cls: 'gs-reset-body' });
    const bodyText = t('settings.reset.modal_body', { cards: this.cardCount, logs: this.logCount });
    for (const line of bodyText.split('\n')) {
      if (line === '') {
        body.createEl('br');
      } else {
        body.createDiv({ text: line });
      }
    }

    contentEl.createDiv({ cls: 'gs-reset-warn', text: t('settings.reset.modal_warn') });

    const token = t('settings.reset.confirm_token');
    const inputWrap = contentEl.createDiv({ cls: 'gs-reset-input-wrap' });
    inputWrap.createDiv({ cls: 'gs-reset-input-label', text: t('settings.reset.input_label', { token }) });
    const input = inputWrap.createEl('input', { cls: 'gs-reset-input', type: 'text' });
    input.placeholder = token;

    const actions = contentEl.createDiv({ cls: 'gs-reset-actions' });
    const cancelBtn = actions.createEl('button', { cls: 'gs-btn', text: t('settings.reset.cancel') });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-danger', text: t('settings.reset.confirm') });
    confirmBtn.disabled = true;

    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value.trim() !== token;
    });

    confirmBtn.addEventListener('click', async () => {
      if (input.value.trim() !== token) return;
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      await this.onConfirm();
      this.close();
      new Notice(t('settings.reset.notice_done'));
    });

    setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
