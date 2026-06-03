import { App, Modal, Component, MarkdownRenderer } from 'obsidian';
import { Rating } from '../card/types';
import { CardManager } from '../card/card-manager';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { ReviewEngine, QueueItem } from '../review/review-engine';
import { RATING_LABELS, RATING_KEY_MAP } from '../review/rating-defs';
import { renderCardAnswer, openCardSource } from '../review/card-render';
import { t, StringKey } from '../i18n';

export class ReviewModal extends Modal {
  private engine: ReviewEngine;
  private cardManager: CardManager;
  private gsStore: GrindstoneStore;
  private component: Component;
  private cardDisplayedAt = 0;
  private answerShown = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    app: App,
    queue: QueueItem[],
    cardManager: CardManager,
    gsStore: GrindstoneStore,
  ) {
    super(app);
    this.engine = new ReviewEngine(queue, gsStore, cardManager);
    this.cardManager = cardManager;
    this.gsStore = gsStore;
    this.component = new Component();
  }

  onOpen(): void {
    this.component.load();
    this.modalEl.addClass('grindstone-review-modal');
    const mode = this.gsStore.getSettings().gsTheme;
    this.modalEl.classList.toggle('gs-force-dark', mode === 'dark');
    this.modalEl.classList.toggle('gs-force-light', mode === 'light');
    this.renderCurrent();
    this.registerKeyboard();
  }

  onClose(): void {
    this.unregisterKeyboard();
    this.component.unload();
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
    const autoShow = this.engine.isAutoShow();

    // Header — single-language title + position
    const head = this.contentEl.createDiv({ cls: 'rvm-head' });
    const headL = head.createDiv({ cls: 'rvm-head-l' });
    headL.createSpan({ cls: 'rvm-head-title', text: t('review.title') });
    headL.createSpan({ cls: 'rvm-head-meta gs-mono', text: `${pos.current} / ${pos.total}` });
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

    // Card metadata
    const metaEl = stage.createDiv({ cls: 'rvm-card-meta gs-mono' });
    metaEl.createSpan({ text: t('review.modal.meta_interval', { n: item.card.interval }) });
    metaEl.createSpan({ text: t('review.modal.meta_ef', { n: item.card.ease.toFixed(2) }) });
    metaEl.createSpan({ text: t('review.modal.meta_reviews', { n: item.card.reviewCount }) });

    // Answer area
    const backWrap = stage.createDiv({ cls: 'rvm-card-back' });
    if (autoShow) {
      this.answerShown = true;
      this.loadAnswer(backWrap, item);
    }

    // Action buttons
    const actions = stage.createDiv({ cls: 'rvm-card-actions' });
    const showBtn = actions.createEl('button', {
      text: autoShow ? t('review.modal.hide') : t('review.modal.show'),
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

    // Rating buttons
    const rateSection = this.contentEl.createDiv({ cls: 'rvm-rate' });
    if (!autoShow) rateSection.style.display = 'none';

    const previews = this.engine.previewIntervals();
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
    hint.textContent = autoShow ? t('review.modal.hint_rate') : t('review.modal.hint_show');

    this.cardDisplayedAt = Date.now();

    (this as any)._backWrap = backWrap;
    (this as any)._showBtn = showBtn;
    (this as any)._rateSection = rateSection;
    (this as any)._hint = hint;
    (this as any)._currentItem = item;
  }

  private async toggleAnswer(): Promise<void> {
    const backWrap = (this as any)._backWrap as HTMLElement;
    const showBtn = (this as any)._showBtn as HTMLButtonElement;
    const rateSection = (this as any)._rateSection as HTMLElement;
    const hint = (this as any)._hint as HTMLElement;
    const item = (this as any)._currentItem as QueueItem;

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

  private async loadAnswer(container: HTMLElement, item: QueueItem): Promise<void> {
    container.empty();
    container.createDiv({ cls: 'rvm-card-divider' });
    const md = container.createDiv({ cls: 'rvm-card-back-md markdown-rendered' });
    await renderCardAnswer(md, item.card, item.id, this.cardManager, this.app, this.component);
  }

  private async doRate(rating: Rating): Promise<void> {
    const elapsed = Date.now() - this.cardDisplayedAt;
    await this.engine.rate(rating, elapsed);
    this.renderCurrent();
    this.modalEl.focus();
  }

  private renderComplete(): void {
    this.contentEl.empty();

    const progress = this.contentEl.createDiv({ cls: 'rvm-progress' });
    progress.createDiv({ cls: 'rvm-progress-fill' }).style.width = '100%';

    const done = this.contentEl.createDiv({ cls: 'rvm-done' });
    done.createEl('h2', { cls: 'rvm-done-title', text: t('review.modal.done_title') });
    done.createEl('p', { cls: 'rvm-done-sub', text: t('review.modal.done_sub', { total: this.engine.getPosition().total }) });
    const closeBtn = done.createEl('button', { cls: 'gs-btn gs-btn-primary', text: t('review.modal.close') });
    closeBtn.addEventListener('click', () => this.close());
  }
}
