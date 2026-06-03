import { App, Modal, Component, MarkdownRenderer } from 'obsidian';
import { Rating, DeckFilter, CramSession } from '../card/types';
import { CardManager } from '../card/card-manager';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { CramEngine, CramItem } from '../review/cram-engine';
import { RATING_LABELS, RATING_KEY_MAP } from '../review/rating-defs';
import { renderCardAnswer, openCardSource } from '../review/card-render';
import { t, StringKey } from '../i18n';

/**
 * Active-review (cram) modal — mirrors ReviewModal's rendering layer but
 * binds to CramEngine. Buttons reuse the 4-button rating UI; semantics are
 * within-session queue control, not SRS scheduling, so interval previews are
 * replaced by queue-effect hints (e.g. "再次见到 · 推后几张").
 */
export class CramModal extends Modal {
  private engine: CramEngine;
  private cardManager: CardManager;
  private gsStore: GrindstoneStore;
  private component: Component;
  private answerShown = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    app: App,
    queue: CramItem[],
    cardManager: CardManager,
    gsStore: GrindstoneStore,
    filter: DeckFilter,
    deckId?: string,
  ) {
    super(app);
    this.engine = new CramEngine(queue, gsStore, filter, deckId);
    this.cardManager = cardManager;
    this.gsStore = gsStore;
    this.component = new Component();
  }

  onOpen(): void {
    this.component.load();
    this.modalEl.addClass('grindstone-review-modal');
    this.modalEl.addClass('grindstone-cram-modal');
    const mode = this.gsStore.getSettings().gsTheme;
    this.modalEl.classList.toggle('gs-force-dark', mode === 'dark');
    this.modalEl.classList.toggle('gs-force-light', mode === 'light');
    this.renderCurrent();
    this.registerKeyboard();
  }

  onClose(): void {
    this.unregisterKeyboard();
    this.component.unload();
    // Persist session log on close (handles early-exit; idempotent if already finished).
    this.engine.finish().catch((err) => {
      console.error('[Grindstone] CramModal: finish() failed', err);
    });
    this.contentEl.empty();
  }

  private registerKeyboard(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (this.engine.isComplete()) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.toggleAnswer();
      } else if (this.answerShown) {
        const rating = RATING_KEY_MAP[e.key];
        if (rating) {
          e.preventDefault();
          this.doRate(rating);
        }
      }
    };
    this.modalEl.addEventListener('keydown', this.keyHandler);
    this.modalEl.tabIndex = -1;
    this.modalEl.focus();
  }

  private unregisterKeyboard(): void {
    if (this.keyHandler) {
      this.modalEl.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  private renderCurrent(): void {
    this.contentEl.empty();
    this.answerShown = false;

    if (this.engine.isComplete()) {
      this.renderComplete();
      return;
    }

    const item = this.engine.getCurrentItem()!;
    const pos = this.engine.getPosition();

    // Header
    const head = this.contentEl.createDiv({ cls: 'rvm-head' });
    const headL = head.createDiv({ cls: 'rvm-head-l' });
    headL.createSpan({ cls: 'rvm-head-title', text: t('cram.title') });
    headL.createSpan({ cls: 'rvm-head-meta gs-mono', text: `${pos.current} / ${pos.total}` });
    const headR = head.createDiv({ cls: 'rvm-head-r' });
    headR.createSpan({ cls: 'gs-pill gs-pill-clay', text: t('cram.pill_isolated') });

    // Progress bar
    const progress = this.contentEl.createDiv({ cls: 'rvm-progress' });
    const fill = progress.createDiv({ cls: 'rvm-progress-fill' });
    fill.style.width = `${this.engine.getProgress() * 100}%`;

    // Stage
    const stage = this.contentEl.createDiv({ cls: 'rvm-stage' });

    // Tags
    const tags = stage.createDiv({ cls: 'rvm-card-tags' });
    const uniqueTags = [...new Set(item.card.tags)];
    for (const tag of uniqueTags) {
      const display = tag.startsWith('#') ? tag : `#${tag}`;
      tags.createSpan({ cls: 'rvm-card-tag', text: display });
    }

    // Title (question). markdown-preview-view: let reading-mode CSS snippets reach
    // the question side too (mirrors the answer container in renderCardAnswer).
    const titleEl = stage.createDiv({ cls: 'rvm-card-title markdown-preview-view' });
    MarkdownRenderer.render(this.app, item.card.blockTitle, titleEl, item.card.file, this.component);

    // Card metadata — cram doesn't move SRS, so show only the persistent cram count.
    const metaEl = stage.createDiv({ cls: 'rvm-card-meta gs-mono' });
    const cramCount = item.card.cram?.count ?? 0;
    metaEl.createSpan({ text: t('cram.meta_cramcount', { n: cramCount }) });

    // Answer area
    const backWrap = stage.createDiv({ cls: 'rvm-card-back' });

    // Action buttons
    const actions = stage.createDiv({ cls: 'rvm-card-actions' });
    const showBtn = actions.createEl('button', {
      text: t('review.modal.show'),
      cls: 'rvm-card-btn',
    });
    showBtn.addEventListener('click', () => this.toggleAnswer());

    const jumpBtn = actions.createEl('button', { text: t('review.modal.jump'), cls: 'rvm-card-btn' });
    jumpBtn.addEventListener('click', async (e) => {
      const startLine = await this.cardManager.getBlockStartLine(item.card, item.id);
      await openCardSource(this.app, item.card.file, startLine, {
        newTab: e.ctrlKey || e.metaKey,
      });
      this.close();
    });

    // Rating buttons — queue-effect hints replace SRS interval previews.
    const rateSection = this.contentEl.createDiv({ cls: 'rvm-rate' });
    rateSection.style.display = 'none';

    const previews = this.cramPreviewLabels();
    for (const def of RATING_LABELS) {
      const btn = rateSection.createEl('button', { cls: `rvm-r rvm-r-${def.rating}` });
      const inner = btn.createDiv({ cls: 'rvm-r-inner' });
      inner.createEl('kbd', { cls: 'rvm-r-kbd gs-mono', text: def.key });
      inner.createDiv({ cls: 'rvm-r-zh', text: t(`review.live.rate.${def.rating}` as StringKey) });
      inner.createDiv({ cls: 'rvm-r-interval gs-mono', text: previews[def.rating] });
      btn.addEventListener('click', () => this.doRate(def.rating));
    }

    // Hint
    const hint = this.contentEl.createDiv({ cls: 'rvm-hint' });
    hint.textContent = t('review.modal.hint_show');

    (this as any)._backWrap = backWrap;
    (this as any)._showBtn = showBtn;
    (this as any)._rateSection = rateSection;
    (this as any)._hint = hint;
    (this as any)._currentItem = item;
  }

  private cramPreviewLabels(): Record<Rating, string> {
    return {
      again: t('cram.preview.again'),
      hard:  t('cram.preview.hard'),
      good:  t('cram.preview.good'),
      easy:  t('cram.preview.easy'),
    };
  }

  private async toggleAnswer(): Promise<void> {
    const backWrap = (this as any)._backWrap as HTMLElement;
    const showBtn = (this as any)._showBtn as HTMLButtonElement;
    const rateSection = (this as any)._rateSection as HTMLElement;
    const hint = (this as any)._hint as HTMLElement;
    const item = (this as any)._currentItem as CramItem;

    if (!this.answerShown) {
      this.answerShown = true;
      await this.loadAnswer(backWrap, item);
      showBtn.setText(t('review.modal.hide'));
      rateSection.style.display = '';
      hint.textContent = t('review.modal.hint_rate');
    } else {
      this.answerShown = false;
      backWrap.empty();
      showBtn.setText(t('review.modal.show'));
      rateSection.style.display = 'none';
      hint.textContent = t('review.modal.hint_show');
    }
    this.modalEl.focus();
  }

  private async loadAnswer(container: HTMLElement, item: CramItem): Promise<void> {
    container.empty();
    container.createDiv({ cls: 'rvm-card-divider' });
    const md = container.createDiv({ cls: 'rvm-card-back-md markdown-rendered' });
    await renderCardAnswer(md, item.card, item.id, this.cardManager, this.app, this.component);
  }

  private async doRate(rating: Rating): Promise<void> {
    await this.engine.rate(rating);
    this.renderCurrent();
    this.modalEl.focus();
  }

  private async renderComplete(): Promise<void> {
    this.contentEl.empty();

    const progress = this.contentEl.createDiv({ cls: 'rvm-progress' });
    progress.createDiv({ cls: 'rvm-progress-fill' }).style.width = '100%';

    // Flush the session log; .finish() is idempotent.
    const session = await this.engine.finish();

    const done = this.contentEl.createDiv({ cls: 'rvm-done' });
    done.createEl('h2', { cls: 'rvm-done-title', text: t('cram.done_title') });

    if (session) {
      const min = Math.max(1, Math.round(session.durationMs / 60000));
      done.createEl('p', { cls: 'rvm-done-sub', text: t('cram.done_sub', {
        unique: session.uniqueCards,
        total: session.totalCards,
        again: session.againCount,
        min,
      }) });
    } else {
      done.createEl('p', { cls: 'rvm-done-sub', text: t('cram.done_empty') });
    }

    const closeBtn = done.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('review.modal.close') });
    closeBtn.addEventListener('click', () => this.close());
  }
}
