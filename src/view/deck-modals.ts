import { App, Modal } from 'obsidian';
import { CustomDeck, DeckFilter, Maturity, normMaturity, CramSession } from '../card/types';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { t } from '../i18n';

const DEFAULT_EMOJIS = ['📚', '🎯', '🌙', '☀️', '🚀', '🐢', '🎨', '🎵', '🧪', '🍵', '📔', '⚡'];

function uid(): string {
  return `dk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Render the icon picker — 12 curated emojis + a free-form text input for
 * pasting any custom emoji. Used by SaveDeckModal and EditDeckModal.
 */
function renderIconPicker(parent: HTMLElement, initial: string, onChange: (icon: string) => void): void {
  let current = initial;
  const emojiBar = parent.createDiv({ cls: 'gs-emoji-picker' });
  const customRow = parent.createDiv({ cls: 'gs-emoji-custom-row' });
  const customInput = customRow.createEl('input', {
    cls: 'gs-emoji-custom-input',
    attr: { type: 'text', placeholder: t('decks.save.icon_custom_ph'), maxlength: '4' },
  });

  const render = () => {
    emojiBar.empty();
    for (const e of DEFAULT_EMOJIS) {
      const btn = emojiBar.createEl('button', { text: e, cls: `gs-emoji-btn${e === current ? ' gs-emoji-on' : ''}` });
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        current = e;
        customInput.value = '';
        render();
        onChange(current);
      });
    }
  };
  render();

  customInput.addEventListener('input', () => {
    const v = customInput.value.trim();
    if (v) {
      current = v;
      render();
      onChange(current);
    }
  });
}

function sortByOrder(decks: CustomDeck[]): CustomDeck[] {
  return [...decks].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

function maturityLabel(ms: Maturity[]): string {
  return ms.map(m =>
    m === 'new'      ? t('tags.chip.new') :
    m === 'learning' ? t('tags.chip.learning') :
                       t('tags.chip.mature'),
  ).join(' · ');
}

/** One-line summary of a filter (used in save-modal preview + deck pill tooltips). */
export function summarizeFilter(filter: DeckFilter): string {
  const parts: string[] = [];
  if (filter.tags.length > 0) {
    parts.push(t('decks.filter_summary.tags', { tags: filter.tags.map(tg => tg.replace(/^#/, '')).join(', ') }));
  }
  if (filter.search) {
    parts.push(t('decks.filter_summary.search', { q: filter.search }));
  }
  const ms = normMaturity(filter.maturity);
  if (ms.length > 0 && ms.length < 3) {
    parts.push(t('decks.filter_summary.maturity', { m: maturityLabel(ms) }));
  }
  return parts.length === 0 ? t('decks.filter_summary.none') : parts.join(' · ');
}

/**
 * Save current filter as a new CustomDeck. Calls onSaved with the new deck
 * (caller persists via gsStore.updateSettings).
 */
export class SaveDeckModal extends Modal {
  private filter: DeckFilter;
  private store: GrindstoneStore;
  private onSaved: (deck: CustomDeck) => void;
  private name = '';
  private icon = DEFAULT_EMOJIS[0];

  constructor(app: App, store: GrindstoneStore, filter: DeckFilter, onSaved: (deck: CustomDeck) => void) {
    super(app);
    this.store = store;
    this.filter = filter;
    this.onSaved = onSaved;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('grindstone-deck-modal');
    contentEl.empty();

    contentEl.createEl('h3', { text: t('decks.save.title'), cls: 'gs-modal-title' });

    // Name input
    const nameRow = contentEl.createDiv({ cls: 'gs-form-row' });
    nameRow.createEl('label', { text: t('decks.save.name_label'), attr: { for: 'gs-deck-name' } });
    const nameInput = nameRow.createEl('input', { attr: { id: 'gs-deck-name', type: 'text', placeholder: t('decks.save.name_ph'), maxlength: '20' } });
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value.trim();
      saveBtn.disabled = this.name.length === 0;
    });

    // Icon picker
    const iconRow = contentEl.createDiv({ cls: 'gs-form-row' });
    iconRow.createEl('label', { text: t('decks.save.icon_label') });
    renderIconPicker(iconRow, this.icon, (icon) => { this.icon = icon; });

    // Filter preview
    const fpRow = contentEl.createDiv({ cls: 'gs-form-row' });
    fpRow.createEl('label', { text: t('decks.save.filter_label') });
    fpRow.createDiv({ cls: 'gs-filter-summary', text: summarizeFilter(this.filter) });

    // Actions
    const actions = contentEl.createDiv({ cls: 'gs-modal-actions' });
    const cancelBtn = actions.createEl('button', { text: t('decks.save.cancel'), cls: 'gs-btn' });
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = actions.createEl('button', { text: t('decks.save.save'), cls: 'gs-btn gs-btn-primary' });
    saveBtn.disabled = true;
    saveBtn.addEventListener('click', async () => {
      if (!this.name) return;
      const existing = this.store.getSettings().customDecks ?? [];
      const maxOrder = existing.reduce((m, d) => Math.max(m, d.order), -1);
      const deck: CustomDeck = {
        id: uid(),
        name: this.name,
        filter: this.filter,
        createdAt: Date.now(),
        order: maxOrder + 1,
        icon: this.icon,
      };
      await this.store.updateSettings({ customDecks: [...existing, deck] });
      this.onSaved(deck);
      this.close();
    });

    setTimeout(() => nameInput.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Edit a single existing deck — name + icon only. Used from the sidebar
 * deck row's right-click menu. Filter is not editable here (re-apply the
 * deck, edit, and Overwrite if you want to change the filter).
 */
export class EditDeckModal extends Modal {
  private store: GrindstoneStore;
  private deck: CustomDeck;
  private onSaved: () => void;
  private name: string;
  private icon: string;

  constructor(app: App, store: GrindstoneStore, deck: CustomDeck, onSaved: () => void) {
    super(app);
    this.store = store;
    this.deck = deck;
    this.onSaved = onSaved;
    this.name = deck.name;
    this.icon = deck.icon ?? DEFAULT_EMOJIS[0];
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('grindstone-deck-modal');
    contentEl.empty();

    contentEl.createEl('h3', { text: t('decks.edit.title'), cls: 'gs-modal-title' });

    const nameRow = contentEl.createDiv({ cls: 'gs-form-row' });
    nameRow.createEl('label', { text: t('decks.save.name_label') });
    const nameInput = nameRow.createEl('input', { attr: { type: 'text', value: this.name, maxlength: '20' } });
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value.trim();
      saveBtn.disabled = this.name.length === 0;
    });

    const iconRow = contentEl.createDiv({ cls: 'gs-form-row' });
    iconRow.createEl('label', { text: t('decks.save.icon_label') });
    renderIconPicker(iconRow, this.icon, (icon) => { this.icon = icon; });

    const actions = contentEl.createDiv({ cls: 'gs-modal-actions' });
    const cancelBtn = actions.createEl('button', { text: t('decks.save.cancel'), cls: 'gs-btn' });
    cancelBtn.addEventListener('click', () => this.close());
    const saveBtn = actions.createEl('button', { text: t('decks.save.save'), cls: 'gs-btn gs-btn-primary' });
    saveBtn.addEventListener('click', async () => {
      if (!this.name) return;
      const decks = this.store.getSettings().customDecks ?? [];
      const next = decks.map(d => d.id === this.deck.id ? { ...d, name: this.name, icon: this.icon } : d);
      await this.store.updateSettings({ customDecks: next });
      this.onSaved();
      this.close();
    });

    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Confirm deletion of a deck — small standalone confirm modal used from
 * the sidebar deck row's right-click menu.
 */
export function confirmDeleteDeck(app: App, store: GrindstoneStore, deck: CustomDeck, onDone: () => void): void {
  const modal = new Modal(app);
  modal.modalEl.addClass('grindstone-deck-modal');
  const { contentEl } = modal;
  contentEl.empty();
  contentEl.createDiv({ cls: 'gs-confirm-msg', text: t('decks.modal.delete_confirm', { name: deck.name }) });
  const btns = contentEl.createDiv({ cls: 'gs-modal-actions' });
  const cancel = btns.createEl('button', { cls: 'gs-btn', text: t('decks.modal.confirm_no') });
  cancel.addEventListener('click', () => modal.close());
  const ok = btns.createEl('button', { cls: 'gs-btn gs-btn-danger', text: t('decks.modal.confirm_yes') });
  ok.addEventListener('click', async () => {
    const decks = store.getSettings().customDecks ?? [];
    await store.updateSettings({ customDecks: decks.filter(d => d.id !== deck.id) });
    onDone();
    modal.close();
  });
  modal.open();
}

/**
 * Manage custom decks — list, drag-sort, inline rename, change icon, delete,
 * view per-deck cram session history. Mutations persist via gsStore; onChanged
 * is called after each persisted mutation so the caller can refresh its UI.
 */
export class DeckManageModal extends Modal {
  private store: GrindstoneStore;
  private onChanged: () => void;
  private expandedHistoryDeckId: string | null = null;

  constructor(app: App, store: GrindstoneStore, onChanged: () => void) {
    super(app);
    this.store = store;
    this.onChanged = onChanged;
  }

  onOpen(): void {
    this.modalEl.addClass('grindstone-deck-modal');
    this.modalEl.addClass('grindstone-deck-manage-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: t('decks.modal.title'), cls: 'gs-modal-title' });
    contentEl.createEl('p', { text: t('decks.modal.sub'), cls: 'gs-modal-sub' });

    const decks = sortByOrder(this.store.getSettings().customDecks ?? []);

    if (decks.length === 0) {
      contentEl.createDiv({ cls: 'gs-deck-empty', text: t('decks.modal.empty') });
    } else {
      const list = contentEl.createDiv({ cls: 'gs-deck-list' });
      for (const deck of decks) {
        this.renderDeckRow(list, deck, decks);
      }
    }

    const actions = contentEl.createDiv({ cls: 'gs-modal-actions' });
    const closeBtn = actions.createEl('button', { text: t('decks.modal.close'), cls: 'gs-btn gs-btn-primary' });
    closeBtn.addEventListener('click', () => this.close());
  }

  private renderDeckRow(parent: HTMLElement, deck: CustomDeck, allDecks: CustomDeck[]): void {
    const row = parent.createDiv({ cls: 'gs-deck-row', attr: { draggable: 'true', 'data-deck-id': deck.id } });

    // Drag handle
    const handle = row.createSpan({ cls: 'gs-deck-handle', text: '⋮⋮' });
    handle.setAttribute('aria-label', 'Drag to reorder');

    // Icon (click to cycle)
    const iconBtn = row.createEl('button', { cls: 'gs-deck-icon-btn', text: deck.icon ?? '📚' });
    iconBtn.title = t('decks.modal.icon');
    iconBtn.addEventListener('click', async () => {
      const idx = DEFAULT_EMOJIS.indexOf(deck.icon ?? DEFAULT_EMOJIS[0]);
      const next = DEFAULT_EMOJIS[(idx + 1) % DEFAULT_EMOJIS.length];
      await this.patchDeck(deck.id, { icon: next });
    });

    // Name (click to rename)
    const nameSpan = row.createSpan({ cls: 'gs-deck-name', text: deck.name });
    nameSpan.title = t('decks.modal.rename');
    nameSpan.addEventListener('click', () => this.startInlineRename(nameSpan, deck));

    // Stats (rates + coverage)
    const cards = this.store.getCardsByTags(new Set(deck.filter.tags), deck.filter.search || undefined);
    const deckMs = normMaturity(deck.filter.maturity);
    const filtered = (deckMs.length === 0 || deckMs.length >= 3)
      ? cards
      : cards.filter(c => deckMs.includes(classifyMaturity(c.card)));
    const totalRates = filtered.reduce((sum, c) => sum + (c.card.cram?.count ?? 0), 0);
    const covered = filtered.filter(c => (c.card.cram?.count ?? 0) > 0).length;
    row.createSpan({ cls: 'gs-deck-meta gs-mono', text: t('decks.modal.deck_meta', {
      count: totalRates,
      covered,
      total: filtered.length,
    }) });

    // Actions
    const actions = row.createSpan({ cls: 'gs-deck-actions' });
    const histBtn = actions.createEl('button', { cls: 'gs-deck-action-btn', text: t('decks.modal.history') });
    histBtn.addEventListener('click', () => {
      this.expandedHistoryDeckId = this.expandedHistoryDeckId === deck.id ? null : deck.id;
      this.render();
    });
    const delBtn = actions.createEl('button', { cls: 'gs-deck-action-btn gs-deck-action-danger', text: t('decks.modal.delete') });
    delBtn.addEventListener('click', () => this.confirmDelete(deck));

    // Inline history panel
    if (this.expandedHistoryDeckId === deck.id) {
      this.renderHistoryPanel(parent, deck);
    }

    this.wireDragHandlers(row, deck, allDecks);
  }

  private renderHistoryPanel(parent: HTMLElement, deck: CustomDeck): void {
    const panel = parent.createDiv({ cls: 'gs-deck-history-panel' });
    const sessions = this.store.getCramSessions().filter(s => s.deckId === deck.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 10);
    if (sessions.length === 0) {
      panel.createDiv({ cls: 'gs-deck-history-empty', text: t('decks.modal.history_empty') });
      return;
    }
    for (const s of sessions) {
      const row = panel.createDiv({ cls: 'gs-deck-history-row' });
      const date = new Date(s.startedAt).toISOString().slice(0, 16).replace('T', ' ');
      row.textContent = t('decks.modal.history_row', { date, unique: s.uniqueCards, again: s.againCount });
    }
  }

  private startInlineRename(nameSpan: HTMLElement, deck: CustomDeck): void {
    const old = deck.name;
    nameSpan.empty();
    const input = nameSpan.createEl('input', { attr: { type: 'text', value: old, maxlength: '20' } });
    input.focus();
    input.select();
    const commit = async () => {
      const next = input.value.trim();
      if (next && next !== old) {
        await this.patchDeck(deck.id, { name: next });
      } else {
        this.render();
      }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { this.render(); }
    });
  }

  private async patchDeck(id: string, patch: Partial<CustomDeck>): Promise<void> {
    const decks = this.store.getSettings().customDecks ?? [];
    const next = decks.map(d => d.id === id ? { ...d, ...patch } : d);
    await this.store.updateSettings({ customDecks: next });
    this.onChanged();
    this.render();
  }

  private confirmDelete(deck: CustomDeck): void {
    const wrap = this.contentEl.createDiv({ cls: 'gs-confirm-overlay' });
    const inner = wrap.createDiv({ cls: 'gs-confirm-card' });
    inner.createDiv({ cls: 'gs-confirm-msg', text: t('decks.modal.delete_confirm', { name: deck.name }) });
    const btns = inner.createDiv({ cls: 'gs-modal-actions' });
    const cancel = btns.createEl('button', { cls: 'gs-btn', text: t('decks.modal.confirm_no') });
    cancel.addEventListener('click', () => wrap.remove());
    const ok = btns.createEl('button', { cls: 'gs-btn gs-btn-danger', text: t('decks.modal.confirm_yes') });
    ok.addEventListener('click', async () => {
      const decks = this.store.getSettings().customDecks ?? [];
      await this.store.updateSettings({ customDecks: decks.filter(d => d.id !== deck.id) });
      this.onChanged();
      this.render();
    });
  }

  private wireDragHandlers(row: HTMLElement, deck: CustomDeck, allDecks: CustomDeck[]): void {
    row.addEventListener('dragstart', (e) => {
      row.classList.add('gs-deck-dragging');
      e.dataTransfer?.setData('text/plain', deck.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => row.classList.remove('gs-deck-dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      row.classList.add('gs-deck-dragover');
    });
    row.addEventListener('dragleave', () => row.classList.remove('gs-deck-dragover'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('gs-deck-dragover');
      const draggedId = e.dataTransfer?.getData('text/plain');
      if (!draggedId || draggedId === deck.id) return;
      await this.reorder(draggedId, deck.id, allDecks);
    });
  }

  private async reorder(draggedId: string, targetId: string, allDecks: CustomDeck[]): Promise<void> {
    const fromIdx = allDecks.findIndex(d => d.id === draggedId);
    const toIdx = allDecks.findIndex(d => d.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...allDecks];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Re-stamp order with 10-step gaps so a future drop can land between.
    const next = reordered.map((d, i) => ({ ...d, order: i * 10 }));
    await this.store.updateSettings({ customDecks: next });
    this.onChanged();
    this.render();
  }
}

function classifyMaturity(card: { reviewCount: number; interval: number }): 'new' | 'learning' | 'mature' {
  if (card.reviewCount === 0) return 'new';
  if (card.interval < 21) return 'learning';
  return 'mature';
}

/** Compare two filters by value (used to detect overwrite-to-deck affordance). */
export function filtersEqual(a: DeckFilter, b: DeckFilter): boolean {
  if (a.search !== b.search) return false;
  // Maturity equality on canonical form: all-three and [] both mean "no constraint".
  const am = normMaturity(a.maturity), bm = normMaturity(b.maturity);
  const ca = am.length >= 3 ? [] : [...am].sort();
  const cb = bm.length >= 3 ? [] : [...bm].sort();
  if (ca.length !== cb.length || !ca.every((x, i) => x === cb[i])) return false;
  if (a.tags.length !== b.tags.length) return false;
  const aSorted = [...a.tags].sort();
  const bSorted = [...b.tags].sort();
  return aSorted.every((t, i) => t === bSorted[i]);
}

/** Find the (single) deck that exactly matches the given filter, if any. */
export function findMatchingDeck(decks: CustomDeck[], filter: DeckFilter): CustomDeck | null {
  return decks.find(d => filtersEqual(d.filter, filter)) ?? null;
}

// Re-export the type for caller convenience.
export type { CramSession };
