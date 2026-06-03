/**
 * True if `tag` matches any entry in `patterns` using Obsidian's nested-tag
 * prefix convention: an entry matches the tag itself or any child below it
 * (e.g. pattern `#Grind` matches `#Grind/easy`). The reverse direction
 * (pattern is more specific than the tag) is also honored when `bidirectional`
 * is set — used by the Tags filter where the selected node may be either
 * an ancestor or descendant of an autoShow pattern.
 */
export function matchesAnyPrefix(
  tag: string,
  patterns: string[],
  bidirectional = false,
): boolean {
  for (const p of patterns) {
    if (tag === p) return true;
    if (tag.startsWith(p + '/')) return true;
    if (bidirectional && p.startsWith(tag + '/')) return true;
  }
  return false;
}

/** True if any of the card's tags matches an autoShow pattern. */
export function cardHasAutoShowTag(
  cardTags: string[],
  autoShowTags: string[],
): boolean {
  return cardTags.some((t) => matchesAnyPrefix(t, autoShowTags));
}
