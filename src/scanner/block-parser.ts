import { CachedMetadata, TagCache, HeadingCache, getAllTags } from 'obsidian';
import { GrindstoneSettings } from '../card/types';
import { extractEmbeddedId, GS_ID_STRIP_REGEX } from '../card/card-id';

export interface CardBlock {
  title: string;        // cleaned title (no stars, no tags, no heading markers, no ID comment)
  startLine: number;    // the trigger line itself
  endLine: number;      // exclusive
  tags: string[];       // all tags found within block range
  rawTitleLine: string; // original line text (for star writeback)
  embeddedId: string | null; // gs:XXXX if present, null otherwise
}

/**
 * Parse card blocks from a file based on trigger-tag lines.
 *
 * A card starts at a line that contains a trigger tag.
 * It ends at whichever comes first:
 *   1. a `---` separator
 *   2. the next trigger-tag line
 *   3. the next heading
 *   4. EOF
 */
export function parseCardBlocks(
  cache: CachedMetadata,
  fileContent: string,
  settings: GrindstoneSettings,
): CardBlock[] {
  const allTags = cache.tags ?? [];
  const lines = fileContent.split('\n');
  const totalLines = lines.length;

  // Find lines that contain at least one trigger tag
  const triggerLineSet = new Set<number>();
  const excludeLineSet = new Set<number>();

  for (const t of allTags) {
    const line = t.position.start.line;
    if (tagMatches(t.tag, settings.triggerTags, settings.prefixMatch)) {
      triggerLineSet.add(line);
    }
    if (tagMatches(t.tag, settings.excludeTags, false)) {
      excludeLineSet.add(line);
    }
  }

  // Remove lines that also have exclude tags
  for (const line of excludeLineSet) {
    triggerLineSet.delete(line);
  }

  const triggerLines = Array.from(triggerLineSet).sort((a, b) => a - b);
  if (triggerLines.length === 0) return [];

  // Heading lines for boundary detection
  const headingLines = new Set(
    (cache.headings ?? []).map((h: HeadingCache) => h.position.start.line),
  );

  const blocks: CardBlock[] = [];

  for (let i = 0; i < triggerLines.length; i++) {
    const startLine = triggerLines[i];
    const nextTrigger = i + 1 < triggerLines.length ? triggerLines[i + 1] : totalLines;

    // Scan for end boundary
    let endLine = nextTrigger;
    for (let ln = startLine + 1; ln < nextTrigger; ln++) {
      const trimmed = lines[ln]?.trim() ?? '';
      if (/^---+\s*$/.test(trimmed)) {
        endLine = ln;
        break;
      }
      if (headingLines.has(ln)) {
        endLine = ln;
        break;
      }
    }

    const rawTitleLine = lines[startLine];
    const title = extractTitle(rawTitleLine);

    // Collect all tags within block range
    const blockTags = allTags
      .filter(
        (t: TagCache) =>
          t.position.start.line >= startLine &&
          t.position.start.line < endLine,
      )
      .map((t: TagCache) => t.tag);

    const embeddedId = extractEmbeddedId(rawTitleLine);
    blocks.push({ title, startLine, endLine, tags: blockTags, rawTitleLine, embeddedId });
  }

  return blocks;
}

/**
 * Extract card title from a trigger line:
 * strip heading markers, stars, and inline tags.
 */
export function extractTitle(line: string): string {
  let s = line;
  // Strip heading markers (e.g. "## ")
  s = s.replace(/^#{1,6}\s+/, '');
  // Strip leading stars (⭐️ = U+2B50 + optional U+FE0F)
  s = s.replace(/^[\u2B50\uFE0F]+/, '');
  // Strip inline tags (#tag, #tag/sub)
  s = s.replace(/#[^\s]+/g, '');
  // Strip embedded card ID comment
  s = s.replace(GS_ID_STRIP_REGEX, '');
  return s.trim();
}

function tagMatches(
  tag: string,
  configured: string[],
  prefixMatch: boolean,
): boolean {
  for (const ct of configured) {
    if (prefixMatch) {
      if (tag === ct || tag.startsWith(ct + '/')) return true;
    } else {
      if (tag === ct) return true;
    }
  }
  return false;
}

/**
 * True if the file carries any tag matching settings.archiveTags.
 * File-level (inline + frontmatter via Obsidian's getAllTags) — coarser
 * than trigger/exclude, by design: archiving is a per-note action.
 */
export function fileIsArchived(
  cache: CachedMetadata,
  settings: GrindstoneSettings,
): boolean {
  if (!settings.archiveTags || settings.archiveTags.length === 0) return false;
  const all = getAllTags(cache) ?? [];
  for (const tag of all) {
    if (tagMatches(tag, settings.archiveTags, settings.prefixMatch)) return true;
  }
  return false;
}
