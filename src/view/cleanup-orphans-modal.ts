import { App, Modal, Notice } from 'obsidian';
import { t } from '../i18n';

export class CleanupOrphanCardsModal extends Modal {
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

    contentEl.createEl('h3', { text: t('settings.cleanup.modal_title') });

    const body = contentEl.createDiv({ cls: 'gs-reset-body' });
    const bodyText = t('settings.cleanup.modal_body', { cards: this.cardCount, logs: this.logCount });
    for (const line of bodyText.split('\n')) {
      if (line === '') body.createEl('br');
      else body.createDiv({ text: line });
    }

    const actions = contentEl.createDiv({ cls: 'gs-reset-actions' });
    const cancelBtn = actions.createEl('button', { cls: 'gs-btn', text: t('settings.cleanup.cancel') });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = actions.createEl('button', { cls: 'gs-btn gs-btn-danger', text: t('settings.cleanup.confirm') });
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      await this.onConfirm();
      this.close();
      new Notice(t('settings.cleanup.notice_done', { cards: this.cardCount }));
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
