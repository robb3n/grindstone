import { Plugin } from 'obsidian';

const GRINDSTONE_ICON = 'flame';

export function addRibbonIcon(
  plugin: Plugin,
  getDueCount: () => number,
  onClickReview: () => void,
): void {
  const ribbonEl = plugin.addRibbonIcon(
    GRINDSTONE_ICON,
    'Grindstone: Start Review',
    () => onClickReview(),
  );
  ribbonEl.addClass('grindstone-ribbon-icon');
}
