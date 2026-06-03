import { App, Notice, TFile } from 'obsidian';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { t } from '../i18n';

export interface RenameOptions {
  /** Bare tag, no '#' prefix. */
  oldTag: string;
  /** Bare tag, no '#' prefix. */
  newTag: string;
  /** When true, also rewrite tags whose path starts with oldTag + '/'. */
  cascade: boolean;
}

export interface RenamePreview {
  files: TFile[];
  tagOccurrences: number;
  cardsAffected: number;
  /** Bare sub-tag paths nested under oldTag in the active card pool. */
  subtags: string[];
}

export interface RenameResult {
  filesAffected: number;
  tagOccurrences: number;
  cardsAffected: number;
  errors: { file: string; error: string }[];
}

const VALID_TAG = /^[\p{L}\p{N}_\-/]+$/u;
const TAG_RE = /(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_\-/]+)/gu;
const INLINE_CODE_RE = /`+[^`\n]+`+/g;
const FENCE_RE = /^[\t ]{0,3}(```+|~~~+)/;

// PUA chars (U+E000..U+E001) — never appear in user content and are not in
// the tag character class. Used to mask inline-code spans during inline-tag
// replacement so a `#tag` flush against a code span still gets matched.
const MASK_OPEN = String.fromCharCode(0xE000);
const MASK_CLOSE = String.fromCharCode(0xE001);
const MASK_RESTORE_RE = new RegExp(MASK_OPEN + '(\\d+)' + MASK_CLOSE, 'g');

export function isValidTagName(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('/') || s.endsWith('/')) return false;
  if (s.includes('//')) return false;
  return VALID_TAG.test(s);
}

export function stripHash(tag: string): string {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}

export function normalizeTagInput(s: string): string {
  return stripHash(s.trim());
}

export function buildRenameFn(
  oldBare: string,
  newBare: string,
  cascade: boolean,
): (t: string) => string {
  const prefix = oldBare + '/';
  return (tag) => {
    if (tag === oldBare) return newBare;
    if (cascade && tag.startsWith(prefix)) return newBare + tag.slice(oldBare.length);
    return tag;
  };
}

export function findSubtags(store: GrindstoneStore, oldBare: string): string[] {
  const subs = new Set<string>();
  const prefix = oldBare + '/';
  for (const card of Object.values(store.getAllCardsMap())) {
    if (card.disabled) continue;
    for (const tag of card.tags) {
      const bare = stripHash(tag);
      if (bare.startsWith(prefix)) subs.add(bare);
    }
  }
  return [...subs].sort();
}

function frontmatterTagStrings(fm: unknown): string[] {
  if (!fm || typeof fm !== 'object') return [];
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(push);
  };
  const obj = fm as Record<string, unknown>;
  push(obj.tags);
  push(obj.tag);
  return out;
}

export function previewTagRename(
  app: App,
  store: GrindstoneStore,
  opts: RenameOptions,
): RenamePreview {
  const renameFn = buildRenameFn(opts.oldTag, opts.newTag, opts.cascade);
  const files: TFile[] = [];
  let occurrences = 0;

  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) continue;

    let fileOcc = 0;

    if (cache.tags) {
      for (const tc of cache.tags) {
        const bare = stripHash(tc.tag);
        if (renameFn(bare) !== bare) fileOcc++;
      }
    }

    for (const raw of frontmatterTagStrings(cache.frontmatter)) {
      const bare = stripHash(raw);
      if (renameFn(bare) !== bare) fileOcc++;
    }

    if (fileOcc > 0) {
      files.push(file);
      occurrences += fileOcc;
    }
  }

  let cardsAffected = 0;
  for (const card of Object.values(store.getAllCardsMap())) {
    if (card.disabled) continue;
    if (card.tags.some(tg => renameFn(stripHash(tg)) !== stripHash(tg))) cardsAffected++;
  }

  return {
    files,
    tagOccurrences: occurrences,
    cardsAffected,
    subtags: findSubtags(store, opts.oldTag),
  };
}

/**
 * Rewrite `#tag` tokens in markdown text. Skips fenced code blocks (``` or ~~~)
 * and inline code spans. Tag boundary rejects letter/digit/underscore/`/` before
 * `#` — keeps URL fragments and identifier-internal `#` untouched.
 */
export function replaceInlineTagsSafe(
  content: string,
  renameFn: (tag: string) => string,
): string {
  const lines = content.split('\n');
  let inFence = false;
  let fenceChar = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
      } else if (marker[0] === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }
    if (inFence) continue;
    lines[i] = renameInLine(line, renameFn);
  }

  return lines.join('\n');
}

function renameInLine(line: string, renameFn: (tag: string) => string): string {
  const masks: string[] = [];
  const masked = line.replace(INLINE_CODE_RE, (m) => {
    masks.push(m);
    return MASK_OPEN + (masks.length - 1) + MASK_CLOSE;
  });

  const renamed = masked.replace(TAG_RE, (full, tag) => {
    const next = renameFn(tag);
    return next === tag ? full : '#' + next;
  });

  return renamed.replace(MASK_RESTORE_RE, (_, idx) => masks[Number(idx)]);
}

/**
 * Apply a tag-rename fn to a settings tag-list (trigger/exclude/archive).
 * Entries are stored with a leading '#'; renameFn works on the bare form.
 * Collisions produced by the rename (an entry that now equals an existing one)
 * are de-duplicated. Returns `changed: true` if any entry was rewritten or a
 * dup dropped, so the caller can decide whether to persist.
 */
export function renameSettingsTagList(
  list: string[] | undefined,
  renameFn: (t: string) => string,
): { next: string[]; changed: boolean } {
  if (!list || list.length === 0) return { next: list ?? [], changed: false };
  let changed = false;
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of list) {
    const hasHash = entry.startsWith('#');
    const bare = hasHash ? entry.slice(1) : entry;
    const renamed = renameFn(bare);
    const out = renamed === bare ? entry : hasHash ? '#' + renamed : renamed;
    if (renamed !== bare) changed = true;
    if (seen.has(out)) { changed = true; continue; } // rename collided with an existing entry — drop the dup
    seen.add(out);
    next.push(out);
  }
  return { next, changed };
}

export async function renameTagInVault(
  app: App,
  store: GrindstoneStore,
  opts: RenameOptions,
): Promise<RenameResult> {
  if (!store.getSettings().renameTagsInVault) {
    new Notice(t('tag_rename.disabled_notice'));
    return { filesAffected: 0, tagOccurrences: 0, cardsAffected: 0, errors: [] };
  }

  const preview = previewTagRename(app, store, opts);
  const renameFn = buildRenameFn(opts.oldTag, opts.newTag, opts.cascade);
  const errors: { file: string; error: string }[] = [];
  let filesWritten = 0;

  for (const file of preview.files) {
    try {
      const cache = app.metadataCache.getFileCache(file);

      const fmHasMatch = frontmatterTagStrings(cache?.frontmatter).some(
        (raw) => renameFn(stripHash(raw)) !== stripHash(raw),
      );
      if (fmHasMatch) {
        await app.fileManager.processFrontMatter(file, (fm) => {
          const norm = (v: unknown): unknown => {
            if (typeof v === 'string') {
              const hasHash = v.startsWith('#');
              const bare = hasHash ? v.slice(1) : v;
              const next = renameFn(bare);
              return next === bare ? v : (hasHash ? '#' + next : next);
            }
            if (Array.isArray(v)) return v.map(norm);
            return v;
          };
          const obj = fm as Record<string, unknown>;
          if (obj.tags !== undefined) obj.tags = norm(obj.tags);
          if (obj.tag !== undefined) obj.tag = norm(obj.tag);
        });
      }

      const inlineHasMatch = (cache?.tags ?? []).some(
        (tc) => renameFn(stripHash(tc.tag)) !== stripHash(tc.tag),
      );
      if (inlineHasMatch) {
        const content = await app.vault.read(file);
        const next = replaceInlineTagsSafe(content, renameFn);
        if (next !== content) {
          await app.vault.modify(file, next);
        }
      }

      filesWritten++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ file: file.path, error: msg });
      console.error(`[Grindstone] tag rename failed for ${file.path}:`, e);
    }
  }

  // Immediate in-memory sync of CardData.tags — independent of the metadataCache
  // re-scan that fires later. Keeps the Tags tab snappy on re-render.
  let cardsAffected = 0;
  for (const [id, card] of Object.entries(store.getAllCardsMap())) {
    let changed = false;
    const nextTags = card.tags.map((tag) => {
      const hasHash = tag.startsWith('#');
      const bare = hasHash ? tag.slice(1) : tag;
      const next = renameFn(bare);
      if (next === bare) return tag;
      changed = true;
      return hasHash ? '#' + next : next;
    });
    if (changed) {
      card.tags = nextTags;
      store.setCard(id, card);
      cardsAffected++;
    }
  }
  if (cardsAffected > 0) {
    await store.save();
    store.invalidatePrimaryDeckCache();
  }

  // Carry the rename into the trigger/exclude/archive tag config. These lists
  // decide which blocks become cards; if the renamed tag was (or sat under) a
  // trigger and the config kept the OLD name, the renamed blocks would stop
  // being recognized and every card under them gets orphaned on the next full
  // scan. Rewriting the config keeps the relationship intact — the per-file
  // rescan fired by the vault writes then re-detects the cards under the new
  // name (race-free: it runs after metadataCache reparses, unlike an immediate
  // full scan which would read stale tags and wrongly disable them).
  const settings = store.getSettings();
  const trig = renameSettingsTagList(settings.triggerTags, renameFn);
  const excl = renameSettingsTagList(settings.excludeTags, renameFn);
  const arch = renameSettingsTagList(settings.archiveTags, renameFn);
  if (trig.changed || excl.changed || arch.changed) {
    await store.updateSettings({
      triggerTags: trig.next,
      excludeTags: excl.next,
      archiveTags: arch.next,
    });
  }

  return {
    filesAffected: filesWritten,
    tagOccurrences: preview.tagOccurrences,
    cardsAffected,
    errors,
  };
}
