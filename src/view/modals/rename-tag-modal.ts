import { App, Modal, Notice, Setting } from 'obsidian';
import { GrindstoneStore } from '../../store/GrindstoneStore';
import { t } from '../../i18n';
import {
  isValidTagName,
  normalizeTagInput,
  previewTagRename,
  renameTagInVault,
  findSubtags,
} from '../../services/tag-rename';

export class RenameTagModal extends Modal {
  private store: GrindstoneStore;
  private oldBare: string;
  private subtags: string[];
  private newValue = '';
  private cascade = true;
  private onDone: () => void;
  private confirmBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private previewEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private inputEl!: HTMLInputElement;

  constructor(
    app: App,
    store: GrindstoneStore,
    /** Bare tag without '#' (e.g. "编程/算法"). */
    oldBare: string,
    onDone: () => void,
  ) {
    super(app);
    this.store = store;
    this.oldBare = oldBare;
    this.subtags = findSubtags(store, oldBare);
    this.onDone = onDone;
  }

  onOpen(): void {
    this.modalEl.addClass('gs-reset-modal');
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: t('tag_rename.modal_title') });

    const body = contentEl.createDiv({ cls: 'gs-reset-body' });

    new Setting(body)
      .setName(t('tag_rename.current_label'))
      .setDesc('#' + this.oldBare);

    new Setting(body)
      .setName(t('tag_rename.new_label'))
      .addText((text) => {
        this.inputEl = text.inputEl;
        text
          .setPlaceholder(t('tag_rename.new_placeholder'))
          .setValue('')
          .onChange((value) => {
            this.newValue = normalizeTagInput(value);
            this.refreshState();
          });
        text.inputEl.style.width = '100%';
      });

    if (this.subtags.length > 0) {
      new Setting(body)
        .setName(t('tag_rename.cascade', { n: this.subtags.length }))
        .addToggle((toggle) => {
          toggle.setValue(this.cascade).onChange((v) => {
            this.cascade = v;
            this.refreshState();
          });
        });
    }

    this.errorEl = body.createDiv({ cls: 'gs-rename-error' });
    this.errorEl.style.color = 'var(--text-error)';
    this.errorEl.style.fontSize = '0.85em';
    this.errorEl.style.minHeight = '1.2em';
    this.errorEl.style.marginTop = '6px';

    this.previewEl = body.createDiv({ cls: 'gs-rename-preview' });
    this.previewEl.style.fontSize = '0.9em';
    this.previewEl.style.opacity = '0.85';
    this.previewEl.style.marginTop = '12px';
    this.previewEl.textContent = t('tag_rename.preview_none');

    const actions = contentEl.createDiv({ cls: 'gs-reset-actions' });
    this.cancelBtn = actions.createEl('button', {
      cls: 'gs-btn',
      text: t('tag_rename.cancel'),
    });
    this.cancelBtn.addEventListener('click', () => this.close());

    this.confirmBtn = actions.createEl('button', {
      cls: 'gs-btn gs-btn-danger',
      text: t('tag_rename.confirm'),
    });
    this.confirmBtn.disabled = true;
    this.confirmBtn.addEventListener('click', () => this.runRename());

    this.inputEl.focus();
    this.refreshState();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private refreshState(): void {
    const err = this.validate();
    this.errorEl.textContent = err ?? '';

    if (err) {
      this.confirmBtn.disabled = true;
      this.previewEl.textContent = t('tag_rename.preview_none');
      return;
    }

    const preview = previewTagRename(this.app, this.store, {
      oldTag: this.oldBare,
      newTag: this.newValue,
      cascade: this.cascade,
    });

    if (preview.files.length === 0) {
      this.confirmBtn.disabled = true;
      this.previewEl.textContent = t('tag_rename.preview_none');
      return;
    }

    this.confirmBtn.disabled = false;
    this.previewEl.textContent = t('tag_rename.preview', {
      files: preview.files.length,
      occurrences: preview.tagOccurrences,
      cards: preview.cardsAffected,
    });
  }

  private validate(): string | null {
    if (!this.newValue) return t('tag_rename.err_empty');
    if (this.newValue === this.oldBare) return t('tag_rename.err_same');
    if (!isValidTagName(this.newValue)) return t('tag_rename.err_invalid');
    return null;
  }

  private async runRename(): Promise<void> {
    if (this.validate()) return;

    this.confirmBtn.disabled = true;
    this.cancelBtn.disabled = true;
    this.confirmBtn.textContent = t('tag_rename.confirm_running');

    try {
      const result = await renameTagInVault(this.app, this.store, {
        oldTag: this.oldBare,
        newTag: this.newValue,
        cascade: this.cascade,
      });

      if (result.filesAffected === 0 && result.errors.length === 0) {
        new Notice(t('tag_rename.notice_noop'));
      } else if (result.errors.length === 0) {
        new Notice(t('tag_rename.notice_done', { n: result.filesAffected }));
      } else {
        new Notice(
          t('tag_rename.notice_partial', {
            ok: result.filesAffected,
            fail: result.errors.length,
          }),
        );
      }

      this.close();
      this.onDone();
    } catch (e) {
      console.error('[Grindstone] rename modal failed:', e);
      this.confirmBtn.disabled = false;
      this.cancelBtn.disabled = false;
      this.confirmBtn.textContent = t('tag_rename.confirm');
      this.errorEl.textContent = e instanceof Error ? e.message : String(e);
    }
  }
}
