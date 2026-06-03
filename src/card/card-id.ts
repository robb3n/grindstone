/**
 * Card ID utilities.
 *
 * New system: 8-char base36 nanoid embedded as `<!-- gs:XXXXXXXX -->` in the trigger line.
 * Legacy system: cyrb53 hash of filePath + title + blockIndex (kept for fallback).
 */

const GS_ID_REGEX = /<!--\s*gs:([a-z0-9]{8})\s*-->/;
const ID_LENGTH = 8;
const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Generate a new 8-char base36 nanoid. */
export function generateCardId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += BASE36_CHARS[bytes[i] % 36];
  }
  return id;
}

/** Extract an embedded card ID from a line, or return null. */
export function extractEmbeddedId(line: string): string | null {
  const match = line.match(GS_ID_REGEX);
  return match ? match[1] : null;
}

/** Build the card key used in the cards Record (e.g. 'gs:k7m2x9p1'). */
export function toCardKey(id: string): string {
  return 'gs:' + id;
}

/** Format the HTML comment to embed in a line. */
export function formatIdComment(id: string): string {
  return `<!-- gs:${id} -->`;
}

/** Inject or replace an ID comment on a line. Returns the modified line. */
export function embedIdInLine(line: string, id: string): string {
  const comment = formatIdComment(id);
  if (GS_ID_REGEX.test(line)) {
    return line.replace(GS_ID_REGEX, comment);
  }
  return line.trimEnd() + ' ' + comment;
}

/** Regex for stripping embedded ID from title extraction. */
export const GS_ID_STRIP_REGEX = /<!--\s*gs:[a-z0-9]{8}\s*-->/g;

// ── Legacy hash (kept for fallback mode) ──

export function computeCardId(
  filePath: string,
  cleanedTitle: string,
  blockIndex: number,
): string {
  let raw = `${filePath}\n${cleanedTitle}`;
  if (blockIndex > 0) {
    raw += `\n${blockIndex}`;
  }
  return cyrb53(raw);
}

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
