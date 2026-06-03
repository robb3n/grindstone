import { DataStore } from '../../storage/data-store';
import { today } from '../../util/date';
import { resolveStrategyName } from './srs';

export interface DeckNode {
  id: string;
  name: string;
  fullTag: string;
  count: number;
  due: number;
  newCount: number;
  mode: 'auto';
  children: DeckNode[];
  /** ISO date of most recent review for any card in this deck (empty if never). */
  lastReviewed: string;
  /** Resolved strategy display name for top-level decks. */
  strategyName?: string;
}

export function getDeckTree(ds: DataStore): DeckNode[] {
  const cards = ds.getAllCards();
  const t = today();

  // Build a map of tag → { count, due, new, lastReviewed }
  interface TagAgg { count: number; due: number; newCount: number; lastReviewed: string }
  const tagAgg = new Map<string, TagAgg>();
  for (const card of Object.values(cards)) {
    if (card.disabled) continue;
    for (const tag of card.tags) {
      if (!tagAgg.has(tag)) tagAgg.set(tag, { count: 0, due: 0, newCount: 0, lastReviewed: '' });
      const agg = tagAgg.get(tag)!;
      agg.count++;
      if (card.due <= t) agg.due++;
      if (card.reviewCount === 0) agg.newCount++;
      if (card.lastReviewed > agg.lastReviewed) agg.lastReviewed = card.lastReviewed;
    }
  }

  interface RawNode {
    name: string;
    fullTag: string;
    count: number;
    due: number;
    newCount: number;
    lastReviewed: string;
    children: Map<string, RawNode>;
  }

  const root = new Map<string, RawNode>();

  for (const [tag, agg] of tagAgg) {
    const parts = tag.split('/');
    let level = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullTag = parts.slice(0, i + 1).join('/');
      if (!level.has(part)) {
        level.set(part, {
          name: part,
          fullTag,
          count: 0,
          due: 0,
          newCount: 0,
          lastReviewed: '',
          children: new Map(),
        });
      }
      const node = level.get(part)!;
      // Only add counts at leaf level to avoid double-counting
      if (i === parts.length - 1) {
        node.count += agg.count;
        node.due += agg.due;
        node.newCount += agg.newCount;
        if (agg.lastReviewed > node.lastReviewed) node.lastReviewed = agg.lastReviewed;
      }
      level = node.children;
    }
  }

  const convert = (map: Map<string, RawNode>): DeckNode[] => {
    return Array.from(map.values()).map((n) => {
      const children = convert(n.children);
      const childCount = children.reduce((a, c) => a + c.count, 0);
      const childDue = children.reduce((a, c) => a + c.due, 0);
      const childNew = children.reduce((a, c) => a + c.newCount, 0);
      const childLastReviewed = children.reduce(
        (a, c) => c.lastReviewed > a ? c.lastReviewed : a, ''
      );
      const lastReviewed = n.lastReviewed > childLastReviewed
        ? n.lastReviewed : childLastReviewed;
      return {
        id: n.fullTag,
        name: n.name,
        fullTag: n.fullTag,
        count: n.count + childCount,
        due: n.due + childDue,
        newCount: n.newCount + childNew,
        mode: 'auto' as const,
        children,
        lastReviewed,
      };
    });
  };

  const tree = convert(root);

  // Populate strategy names for top-level decks
  for (const node of tree) {
    node.strategyName = resolveStrategyName(ds, node.fullTag);
  }

  return tree;
}
