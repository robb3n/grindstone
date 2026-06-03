import { App, CachedMetadata, TFile } from 'obsidian';
import { CardData, GrindstoneSettings, Rating } from './types';
import { computeCardId, generateCardId, toCardKey, embedIdInLine, extractEmbeddedId } from './card-id';
import { parseCardBlocks, CardBlock, fileIsArchived } from '../scanner/block-parser';
import { initialCardState } from '../srs/sm2';
import { DataStore } from '../storage/data-store';
import { today as todayStr } from '../util/date';

export class CardManager {
  private app: App;
  private store: DataStore;
  private onCardTagsChanged?: () => void;
  private _idWriteInProgress = new Set<string>();
  private _scanTimers = new Map<string, number>();
  private _disposed = false;

  constructor(app: App, store: DataStore, onCardTagsChanged?: () => void) {
    this.app = app;
    this.store = store;
    this.onCardTagsChanged = onCardTagsChanged;
  }

  /** True if the given file is currently being modified by ID embedding. */
  isWritingIds(filePath: string): boolean {
    return this._idWriteInProgress.has(filePath);
  }

  /**
   * Coalesce rapid metadata-change events on the same file into a single scan.
   * Live editing fires `metadataCache.changed` on every keystroke after a short
   * internal delay — without this, every keystroke runs parseCardBlocks for
   * the whole file. Save still goes through the store's own debounce, so the
   * combined latency from keystroke to disk is roughly delayMs + 300ms.
   *
   * Only used by the live-edit listener. fullScan() and one-shot callers
   * (e.g. demo note creation) still call scanFile directly because they need
   * the synchronous return value.
   */
  scanFileDebounced(file: TFile, delayMs = 200): void {
    if (this._disposed) return;
    const existing = this._scanTimers.get(file.path);
    if (existing != null) window.clearTimeout(existing);
    const timer = window.setTimeout(async () => {
      this._scanTimers.delete(file.path);
      if (this._disposed) return;
      try {
        await this.scanFile(file);
        this.store.saveDebounced();
      } catch (err) {
        console.error(`[Grindstone] scanFileDebounced failed for ${file.path}:`, err);
      }
    }, delayMs);
    this._scanTimers.set(file.path, timer);
  }

  /** Cancel any pending scan timers and refuse new ones. Call from plugin onunload. */
  dispose(): void {
    this._disposed = true;
    for (const timer of this._scanTimers.values()) window.clearTimeout(timer);
    this._scanTimers.clear();
  }

  async fullScan(): Promise<void> {
    const settings = this.store.getSettings();
    const seenIds = new Set<string>();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const ids = await this.scanFile(file, settings);
      for (const id of ids) seenIds.add(id);
    }

    // Disable cards whose blocks are no longer detected
    for (const [id, card] of Object.entries(this.store.getAllCards())) {
      if (!seenIds.has(id) && !card.disabled) {
        card.disabled = true;
        this.store.setCard(id, card);
      }
    }

    await this.store.save();
  }

  async scanFile(file: TFile, settings?: GrindstoneSettings): Promise<string[]> {
    if (!settings) settings = this.store.getSettings();

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return [];

    const content = await this.app.vault.cachedRead(file);
    const blocks = parseCardBlocks(cache, content, settings);
    const fileArchived = fileIsArchived(cache, settings);

    if (!settings.embedCardIds) {
      return this.scanFileLegacy(file, blocks, settings, fileArchived);
    }

    const ids: string[] = [];
    const lines = content.split('\n');
    const pendingEmbeds: Array<{ lineIndex: number; id: string }> = [];
    let tagsChanged = false;

    for (const block of blocks) {
      let cardId: string;
      if (block.embeddedId) {
        cardId = block.embeddedId;
      } else {
        cardId = generateCardId();
        pendingEmbeds.push({ lineIndex: block.startLine, id: cardId });
      }

      const key = toCardKey(cardId);
      ids.push(key);

      const existing = this.store.getCard(key);
      if (existing) {
        if (!sameTags(existing.tags, block.tags)) tagsChanged = true;
        existing.file = file.path;
        existing.blockStartLine = block.startLine;
        existing.tags = block.tags;
        existing.blockTitle = block.title;
        existing.disabled = false;
        if (existing.archived === true && fileArchived === false) {
          existing.due = todayStr();
        }
        existing.archived = fileArchived;
        this.store.setCard(key, existing);
      } else {
        const today = todayStr();
        const init = initialCardState();
        const card: CardData = {
          file: file.path,
          blockTitle: block.title,
          blockStartLine: block.startLine,
          tags: block.tags,
          interval: init.interval,
          ease: init.ease,
          due: today,
          lastReviewed: '',
          reviewCount: init.reviewCount,
          createdAt: today,
          archived: fileArchived,
        };
        this.store.setCard(key, card);
      }
    }

    if (tagsChanged) this.onCardTagsChanged?.();

    // Batch-write new IDs back to the file
    if (pendingEmbeds.length > 0) {
      this._idWriteInProgress.add(file.path);
      for (const { lineIndex, id } of pendingEmbeds) {
        lines[lineIndex] = embedIdInLine(lines[lineIndex], id);
      }
      await this.app.vault.modify(file, lines.join('\n'));
      setTimeout(() => this._idWriteInProgress.delete(file.path), 1000);
    }

    return ids;
  }

  /** Legacy hash-based scan (embedCardIds = false). */
  private scanFileLegacy(
    file: TFile,
    blocks: CardBlock[],
    settings: GrindstoneSettings,
    fileArchived: boolean,
  ): string[] {
    const ids: string[] = [];
    const titleCounts: Record<string, number> = {};
    let tagsChanged = false;

    for (const block of blocks) {
      const blockIndex = titleCounts[block.title] ?? 0;
      titleCounts[block.title] = blockIndex + 1;

      const cardId = computeCardId(file.path, block.title, blockIndex);
      ids.push(cardId);

      const existing = this.store.getCard(cardId);
      if (existing) {
        if (!sameTags(existing.tags, block.tags)) tagsChanged = true;
        existing.file = file.path;
        existing.blockStartLine = block.startLine;
        existing.tags = block.tags;
        existing.blockTitle = block.title;
        existing.disabled = false;
        if (existing.archived === true && fileArchived === false) {
          existing.due = todayStr();
        }
        existing.archived = fileArchived;
        this.store.setCard(cardId, existing);
      } else {
        const today = todayStr();
        const init = initialCardState();
        const card: CardData = {
          file: file.path,
          blockTitle: block.title,
          blockStartLine: block.startLine,
          tags: block.tags,
          interval: init.interval,
          ease: init.ease,
          due: today,
          lastReviewed: '',
          reviewCount: init.reviewCount,
          createdAt: today,
          archived: fileArchived,
        };
        this.store.setCard(cardId, card);
      }
    }

    if (tagsChanged) this.onCardTagsChanged?.();

    return ids;
  }

  async getBlockContent(card: CardData, cardId?: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(card.file);
    if (!(file instanceof TFile)) return '';

    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return '';

    const settings = this.store.getSettings();
    const blocks = parseCardBlocks(cache, content, settings);
    const lines = content.split('\n');

    let matched: CardBlock | null = null;

    if (cardId && cardId.startsWith('gs:')) {
      const embId = cardId.slice(3);
      matched = blocks.find(b => b.embeddedId === embId) ?? null;
    }
    if (!matched && card.blockStartLine != null) {
      matched = blocks.find(b => b.startLine === card.blockStartLine) ?? null;
    }
    if (!matched) {
      matched = blocks.find(b => b.title === card.blockTitle) ?? null;
    }
    if (!matched) return '';

    const contentStart = matched.startLine + 1;
    const contentEnd = matched.endLine;
    const body = lines.slice(contentStart, contentEnd).join('\n');
    return appendFootnoteDefinitions(body, cache, lines, contentStart, contentEnd);
  }

  /** Resolve the current start line for a card by re-parsing its file. */
  async getBlockStartLine(card: CardData, cardId: string): Promise<number | null> {
    const file = this.app.vault.getAbstractFileByPath(card.file);
    if (!(file instanceof TFile)) return null;

    const content = await this.app.vault.cachedRead(file);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return null;

    const blocks = parseCardBlocks(cache, content, this.store.getSettings());

    if (cardId.startsWith('gs:')) {
      const embId = cardId.slice(3);
      for (const block of blocks) {
        if (block.embeddedId === embId) return block.startLine;
      }
    }
    for (const block of blocks) {
      if (block.title === card.blockTitle) return block.startLine;
    }
    return null;
  }

  /**
   * Write star rating back to the source file's trigger line.
   * Again = ⭐️⭐️⭐️, Hard = ⭐️⭐️, Good = ⭐️, Easy = no star.
   */
  async writeStarsBack(card: CardData, cardId: string, rating: Rating): Promise<void> {
    if (!this.store.getSettings().writeStarsBack) return;

    const file = this.app.vault.getAbstractFileByPath(card.file);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    // Find the correct line
    let lineIdx: number | undefined;

    if (cardId.startsWith('gs:')) {
      const embId = cardId.slice(3);
      const pattern = new RegExp(`<!--\\s*gs:${embId}\\s*-->`);
      const idx = lines.findIndex(l => pattern.test(l));
      if (idx !== -1) lineIdx = idx;
    }

    if (lineIdx == null) {
      lineIdx = card.blockStartLine;
    }

    if (lineIdx == null || lineIdx >= lines.length) return;

    // Strip existing stars from the line start (after optional heading markers)
    let line = lines[lineIdx];
    const headingMatch = line.match(/^(#{1,6}\s+)/);
    const prefix = headingMatch ? headingMatch[1] : '';
    let rest = headingMatch ? line.slice(prefix.length) : line;
    rest = rest.replace(/^[\u2B50\uFE0F]+/, '');

    // Prepend new stars
    const starCount = rating === 'again' ? 3 : rating === 'hard' ? 2 : rating === 'good' ? 1 : 0;
    const stars = '\u2B50\uFE0F'.repeat(starCount);
    lines[lineIdx] = prefix + stars + rest;

    await this.app.vault.modify(file, lines.join('\n'));
  }

  handleRename(oldPath: string, newPath: string): void {
    for (const [id, card] of Object.entries(this.store.getAllCards())) {
      if (card.file === oldPath) {
        card.file = newPath;
        this.store.setCard(id, card);
      }
    }
  }

  handleDelete(filePath: string): void {
    for (const [id, card] of Object.entries(this.store.getAllCards())) {
      if (card.file === filePath && !card.disabled) {
        card.disabled = true;
        this.store.setCard(id, card);
      }
    }
  }

  // ── Migration ──

  async migrateToEmbeddedIds(): Promise<{ migrated: number; failed: number }> {
    const oldCards = { ...this.store.getAllCards() };
    const keyMapping = new Map<string, string>();
    let migrated = 0;
    let failed = 0;

    // Group old active cards by file
    const cardsByFile = new Map<string, Array<{ oldKey: string; card: CardData }>>();
    for (const [key, card] of Object.entries(oldCards)) {
      if (key.startsWith('gs:')) continue; // already migrated
      if (card.disabled) continue;
      const list = cardsByFile.get(card.file) ?? [];
      list.push({ oldKey: key, card });
      cardsByFile.set(card.file, list);
    }

    for (const [filePath, entries] of cardsByFile) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        failed += entries.length;
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) { failed += entries.length; continue; }

        const settings = this.store.getSettings();
        const blocks = parseCardBlocks(cache, content, settings);
        const lines = content.split('\n');
        let modified = false;

        for (const { oldKey, card } of entries) {
          // Find matching block by title first, then startLine
          let matchedBlock: CardBlock | undefined;
          for (const block of blocks) {
            if (block.title === card.blockTitle) { matchedBlock = block; break; }
          }
          if (!matchedBlock && card.blockStartLine != null) {
            for (const block of blocks) {
              if (block.startLine === card.blockStartLine) { matchedBlock = block; break; }
            }
          }

          if (!matchedBlock) { failed++; continue; }

          // Reuse existing embedded ID if present (partial prior migration)
          let newId: string;
          if (matchedBlock.embeddedId) {
            newId = matchedBlock.embeddedId;
          } else {
            newId = generateCardId();
            lines[matchedBlock.startLine] = embedIdInLine(lines[matchedBlock.startLine], newId);
            modified = true;
          }

          keyMapping.set(oldKey, toCardKey(newId));
          migrated++;
        }

        if (modified) {
          await this.app.vault.modify(file, lines.join('\n'));
        }
      } catch (err) {
        console.error(`[Grindstone] Migration failed for ${filePath}:`, err);
        failed += entries.length;
      }
    }

    // Remap card entries
    for (const [oldKey, newKey] of keyMapping) {
      const card = this.store.getCard(oldKey);
      if (card) {
        this.store.setCard(newKey, card);
        this.store.deleteCard(oldKey);
      }
    }

    // Remap review log references
    const logs = this.store.getReviewLogs();
    for (const log of logs) {
      const newKey = keyMapping.get(log.cardId);
      if (newKey) log.cardId = newKey;
    }

    return { migrated, failed };
  }
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Footnote refs inside a card block ([^n]) only render as bracketed superscript
// anchors if their definition ([^n]: ...) lives in the same markdown string passed
// to MarkdownRenderer.render. Definitions usually sit at the file bottom, outside
// the block — so we append them here. Uses cache.footnoteRefs / cache.footnotes
// (Obsidian ≥ 1.8.7); older versions degrade to the pre-fix bare-digit behavior.
function appendFootnoteDefinitions(
  body: string,
  cache: CachedMetadata,
  lines: string[],
  contentStart: number,
  contentEnd: number,
): string {
  const refs = cache.footnoteRefs;
  const defs = cache.footnotes;
  if (!refs || !defs) return body;

  const inBlockRefs = refs
    .filter(r => r.position.start.line >= contentStart && r.position.start.line < contentEnd)
    .sort((a, b) => a.position.start.line - b.position.start.line);
  if (inBlockRefs.length === 0) return body;

  const seenIds = new Set<string>();
  const orderedIds: string[] = [];
  for (const r of inBlockRefs) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    orderedIds.push(r.id);
  }

  const collected: string[] = [];
  for (const id of orderedIds) {
    const def = defs.find(
      d =>
        d.id === id &&
        (d.position.start.line < contentStart || d.position.start.line >= contentEnd),
    );
    if (!def) continue;

    let end = def.position.end.line;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      const isContinuation = next === '' || /^[ \t]/.test(next);
      const isNewDef = /^\[\^[^\]]+\]:/.test(next);
      if (!isContinuation || isNewDef) break;
      end++;
    }
    collected.push(lines.slice(def.position.start.line, end + 1).join('\n'));
  }

  if (collected.length === 0) return body;
  return body + '\n\n' + collected.join('\n\n');
}
