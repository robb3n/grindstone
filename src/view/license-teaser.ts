/**
 * Pro Teaser — the locked state of a Pro tab (spec §6). Shows a dimmed preview
 * skeleton of the real layout behind a central upgrade card, so the user sees
 * "there's something here" without any countdown / urgency clock (Obsidian
 * local-first culture rejects those). The CTA links to the afdian product page;
 * a secondary action jumps to Settings → License for users who already bought.
 */
import { BUY_URL } from '../license';
import { t, StringKey } from '../i18n';
import { setHtml } from '../util/dom';

export type ProFeature = 'cards' | 'strategy' | 'radar';

export interface TeaserHooks {
  /** Open Obsidian settings on the Grindstone License section. */
  openLicenseSettings: () => void;
}

/** Shared Pro-lock glyph — single source of truth for all upsell affordances. */
export const LOCK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

const FEATURE_DESC: Record<ProFeature, StringKey> = {
  cards: 'license.teaser.cards_desc',
  strategy: 'license.teaser.strategy_desc',
  radar: 'license.teaser.radar_desc',
};

const FEATURE_LABEL: Record<ProFeature, StringKey> = {
  cards: 'nav.tags',
  strategy: 'nav.strategy',
  radar: 'nav.radar',
};

/** Renders the teaser into `container`. Returns a no-op cleanup for symmetry. */
export function renderTeaser(
  container: HTMLElement,
  feature: ProFeature,
  hooks: TeaserHooks,
): () => void {
  container.empty();
  const wrap = container.createDiv({ cls: `gs-teaser gs-teaser--${feature}` });

  // Dimmed preview skeleton — gestures at the real layout behind a blur.
  const bg = wrap.createDiv({ cls: 'gs-teaser-bg' });
  bg.createDiv({ cls: 'gs-teaser-skel gs-teaser-skel--head' });
  const grid = bg.createDiv({ cls: 'gs-teaser-skel-grid' });
  for (let i = 0; i < 6; i++) grid.createDiv({ cls: 'gs-teaser-skel gs-teaser-skel--card' });

  // Central upgrade card.
  const card = wrap.createDiv({ cls: 'gs-teaser-card' });
  const lock = card.createDiv({ cls: 'gs-teaser-lock' });
  setHtml(lock, LOCK_SVG);

  card.createDiv({
    cls: 'gs-teaser-title',
    text: t('license.teaser.title', { feature: t(FEATURE_LABEL[feature]) }),
  });
  card.createDiv({ cls: 'gs-teaser-desc', text: t(FEATURE_DESC[feature]) });
  card.createDiv({ cls: 'gs-teaser-price', text: t('license.teaser.price') });

  const cta = card.createEl('button', { cls: 'gs-teaser-cta', text: t('license.teaser.cta') });
  cta.addEventListener('click', () => window.open(BUY_URL, '_blank'));

  const secondary = card.createEl('button', {
    cls: 'gs-teaser-secondary',
    text: t('license.teaser.have_key'),
  });
  secondary.addEventListener('click', () => hooks.openLicenseSettings());

  return () => {};
}

/**
 * Compact one-line locked placeholder — for the radar codeblock and standalone
 * leaf, where a full teaser would be out of place (spec §6).
 */
export function renderInlineLocked(container: HTMLElement): void {
  const el = container.createDiv({ cls: 'gs-locked-inline' });
  const lock = el.createSpan({ cls: 'gs-locked-inline-icon' });
  setHtml(lock, LOCK_SVG);
  el.createSpan({ text: t('license.locked.radar_inline') });
}
