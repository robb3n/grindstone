import { DataStore } from '../../storage/data-store';
import { CardEntry } from './review';
import { getAccuracyByTag } from './stats';

export interface TagTreeNode {
  path: string;
  name: string;
  count: number;
  children: TagTreeNode[];
}

export function getTagTree(ds: DataStore): TagTreeNode[] {
  const cards = ds.getAllCards();
  const root: Record<string, { path: string; name: string; count: number; children: Record<string, any> }> = {};

  for (const card of Object.values(cards)) {
    if (card.disabled) continue;
    for (const tag of card.tags) {
      const parts = tag.split('/');
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const path = parts.slice(0, i + 1).join('/');
        if (!cur[part]) {
          cur[part] = { path, name: part, count: 0, children: {} };
        }
        cur[part].count++;
        cur = cur[part].children;
      }
    }
  }

  const toArr = (obj: Record<string, any>): TagTreeNode[] =>
    Object.values(obj).map((n: any) => ({
      path: n.path,
      name: n.name,
      count: n.count,
      children: toArr(n.children),
    }));

  return toArr(root);
}

export function getCardsByTag(ds: DataStore, tag: string | null, search?: string): CardEntry[] {
  let entries: CardEntry[];
  if (tag) {
    entries = ds.getCardsByTag(tag);
  } else {
    entries = Object.entries(ds.getAllCards())
      .filter(([, c]) => !c.disabled)
      .map(([id, card]) => ({ id, card }));
  }

  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.card.blockTitle.toLowerCase().includes(q) ||
        e.card.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return entries;
}

/** Get cards matching ALL given tags (AND logic). Each tag uses prefix match for sub-tags. */
export function getCardsByTags(ds: DataStore, tags: Set<string>, search?: string): CardEntry[] {
  let entries: CardEntry[];
  if (tags.size === 0) {
    entries = Object.entries(ds.getAllCards())
      .filter(([, c]) => !c.disabled)
      .map(([id, card]) => ({ id, card }));
  } else {
    entries = Object.entries(ds.getAllCards())
      .filter(([, c]) => !c.disabled)
      .map(([id, card]) => ({ id, card }))
      .filter((e) =>
        [...tags].every((tag) =>
          e.card.tags.some((t) => t === tag || t.startsWith(tag + '/'))
        )
      );
  }

  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.card.blockTitle.toLowerCase().includes(q) ||
        e.card.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return entries;
}

/** Accuracy for a tag, aggregating all sub-tags if it's a parent node. */
export function getAccuracyForTag(ds: DataStore, tag: string): number | null {
  const all = getAccuracyByTag(ds);
  const matches = all.filter(
    (a) => a.tag === tag || a.tag.startsWith(tag + '/'),
  );
  if (matches.length === 0) return null;
  const totalReviews = matches.reduce((a, m) => a + m.reviewCount, 0);
  if (totalReviews === 0) return null;
  const weightedSum = matches.reduce(
    (a, m) => a + m.accuracy * m.reviewCount, 0,
  );
  return Math.round(weightedSum / totalReviews);
}
