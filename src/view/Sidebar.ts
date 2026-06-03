import { TabId } from './WorkspaceView';
import { t, StringKey } from '../i18n';
import { setHtml } from '../util/dom';

interface NavItem {
  id: TabId;
  labelKey: StringKey;
  iconPath: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', labelKey: 'nav.overview',
    iconPath: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z' },
  { id: 'review',   labelKey: 'nav.review',
    iconPath: 'M21 12a9 9 0 11-3-6.7M21 4v5h-5' },
  { id: 'strategy', labelKey: 'nav.strategy',
    iconPath: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { id: 'tags',     labelKey: 'nav.tags',
    iconPath: 'M20 12L12 20l-9-9V3h8zM7 7h.01' },
  { id: 'stats',    labelKey: 'nav.stats',
    iconPath: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'radar',    labelKey: 'nav.radar',
    iconPath: 'M12 2L22 8.5L18.5 20H5.5L2 8.5zM12 7L17 10.5L15.5 17H8.5L7 10.5z' },
];

// Streak icons — sprout (alive) / drooping sprout (streak=0) / water droplet (freeze badge).
const SPROUT_PATH  = 'M12 22V10 M12 10c0-3 2-5 5-5 0 3-2 5-5 5z M12 13c0-3-2-5-5-5 0 3 2 5 5 5z';
const WILTED_PATH  = 'M12 22V10 M12 12c3 0 5 2 5 5-3 0-5-2-5-5z M12 14c-3 0-5 2-5 5 3 0 5-2 5-5z';
const DROPLET_PATH = 'M12 2.5C8 8 5 12 5 15a7 7 0 0 0 14 0c0-3-3-7-7-12.5z';

export interface SidebarOptions {
  activeTab: TabId;
  onNavigate: (tab: TabId) => void;
  dueCount: number;
  streak: number;
  /** Current freeze bank (0 in strict mode). */
  freezes: number;
  /** When true, the freeze system is disabled — hide the 💧 badge entirely. */
  strictMode: boolean;
  onToggleTheme: () => void;
  themeMode: 'light' | 'dark' | undefined;
  isDark: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** A Pro tab the current license doesn't cover → render a lock badge. */
  isLocked: (tab: TabId) => boolean;
}

export function renderSidebar(el: HTMLElement, opts: SidebarOptions): void {
  if (opts.collapsed) {
    renderCollapsed(el, opts);
  } else {
    renderExpanded(el, opts);
  }
}

/* ── Expanded (default) ──────────────────────────── */

function renderExpanded(el: HTMLElement, opts: SidebarOptions): void {
  // Logo + collapse button
  const logo = el.createDiv({ cls: 'gs-rail-logo' });
  const mark = logo.createDiv({ cls: 'gs-rail-mark', text: '磨' });
  mark.style.cursor = 'pointer';
  mark.addEventListener('click', () => opts.onToggleCollapse());
  const logoText = logo.createDiv();
  logoText.createDiv({ cls: 'gs-rail-zh', text: t('sidebar.logo') });

  const collapseBtn = logo.createEl('button', { cls: 'gs-rail-collapse-btn', text: '«' });
  collapseBtn.setAttribute('aria-label', t('sidebar.collapse_aria'));
  collapseBtn.addEventListener('click', () => opts.onToggleCollapse());

  // Navigation
  const navSection = el.createDiv();
  navSection.createDiv({ cls: 'gs-rail-section', text: t('sidebar.section') });
  const nav = navSection.createEl('nav', { cls: 'gs-rail-nav' });

  for (const item of NAV_ITEMS) {
    const btn = nav.createEl('button', {
      cls: `gs-rail-item${opts.activeTab === item.id ? ' gs-rail-item-on' : ''}`,
    });
    btn.addEventListener('click', () => opts.onNavigate(item.id));

    const svg = createSvgIcon(item.iconPath);
    btn.appendChild(svg);

    btn.createSpan({ text: t(item.labelKey) });

    if (item.id === 'review' && opts.dueCount > 0) {
      btn.createSpan({ cls: 'gs-rail-item-badge', text: String(opts.dueCount) });
    }
    if (opts.isLocked(item.id)) {
      btn.addClass('gs-rail-item-locked');
      btn.createSpan({ cls: 'gs-rail-item-lock' }).appendChild(createLockIcon(12));
    }
  }

  // Footer: streak + theme toggle
  const foot = el.createDiv({ cls: 'gs-rail-foot' });

  const streakCls = 'gs-rail-streak' + (opts.streak === 0 ? ' gs-rail-streak--wilted' : '');
  const streak = foot.createDiv({ cls: streakCls });
  const iconWrap = streak.createSpan({ cls: 'gs-rail-streak-icon' });
  iconWrap.appendChild(createSvgIcon(opts.streak > 0 ? SPROUT_PATH : WILTED_PATH));
  const streakText = streak.createDiv();
  streakText.createDiv({ cls: 'gs-rail-streak-num', text: String(opts.streak) });
  streakText.createDiv({ cls: 'gs-rail-streak-cap', text: t('sidebar.streak_cap') });
  if (!opts.strictMode) {
    const cls = opts.freezes > 0
      ? 'gs-rail-streak-freeze'
      : 'gs-rail-streak-freeze gs-rail-streak-freeze--zero';
    const fz = streak.createSpan({ cls });
    fz.appendChild(createSvgIcon(DROPLET_PATH));
    fz.appendChild(document.createTextNode(`×${opts.freezes}`));
    fz.setAttribute('title', t('sidebar.freeze_tooltip', { n: opts.freezes }));
  }

  renderThemeToggle(foot, opts, false);
}

/* ── Collapsed (icon-only) ───────────────────────── */

function renderCollapsed(el: HTMLElement, opts: SidebarOptions): void {
  // Logo mark only — click to expand
  const logo = el.createDiv({ cls: 'gs-rail-logo' });
  const mark = logo.createDiv({ cls: 'gs-rail-mark', text: '磨' });
  mark.style.cursor = 'pointer';
  mark.setAttribute('aria-label', t('sidebar.expand_aria'));
  mark.addEventListener('click', () => opts.onToggleCollapse());

  // Navigation icons only
  const nav = el.createEl('nav', { cls: 'gs-rail-nav' });

  for (const item of NAV_ITEMS) {
    const label = t(item.labelKey);
    const tooltip = item.id === 'review' && opts.dueCount > 0
      ? `${label} (${opts.dueCount})`
      : label;
    const btn = nav.createEl('button', {
      cls: `gs-rail-item${opts.activeTab === item.id ? ' gs-rail-item-on' : ''}`,
      attr: { 'aria-label': tooltip, title: tooltip },
    });
    btn.addEventListener('click', () => opts.onNavigate(item.id));

    const svg = createSvgIcon(item.iconPath);
    btn.appendChild(svg);

    // Dot indicator for review in collapsed mode
    if (item.id === 'review' && opts.dueCount > 0) {
      btn.createSpan({ cls: 'gs-rail-item-dot' });
    }
    if (opts.isLocked(item.id)) {
      btn.addClass('gs-rail-item-locked');
      btn.createSpan({ cls: 'gs-rail-item-lock gs-rail-item-lock--mini' }).appendChild(createLockIcon(10));
    }
  }

  // Footer: compact streak + theme icon
  const foot = el.createDiv({ cls: 'gs-rail-foot' });

  const streakCls = 'gs-rail-streak' + (opts.streak === 0 ? ' gs-rail-streak--wilted' : '');
  const streak = foot.createDiv({ cls: streakCls });
  const iconWrap = streak.createSpan({ cls: 'gs-rail-streak-icon' });
  iconWrap.appendChild(createSvgIcon(opts.streak > 0 ? SPROUT_PATH : WILTED_PATH));
  streak.createSpan({ cls: 'gs-rail-streak-num', text: String(opts.streak) });
  if (!opts.strictMode) {
    const cls = opts.freezes > 0
      ? 'gs-rail-streak-freeze'
      : 'gs-rail-streak-freeze gs-rail-streak-freeze--zero';
    const fz = streak.createSpan({ cls });
    fz.appendChild(createSvgIcon(DROPLET_PATH));
    fz.appendChild(document.createTextNode(String(opts.freezes)));
    fz.setAttribute('title', t('sidebar.freeze_short', { n: opts.freezes }));
  }

  renderThemeToggle(foot, opts, true);
}

/* ── Shared: theme toggle ────────────────────────── */

function renderThemeToggle(parent: HTMLElement, opts: SidebarOptions, iconOnly: boolean): void {
  const toggle = parent.createEl('button', { cls: 'gs-themetoggle' });
  toggle.addEventListener('click', () => opts.onToggleTheme());

  const label = !opts.themeMode
    ? t('sidebar.theme_auto')
    : opts.themeMode === 'dark'
      ? t('sidebar.theme_dark')
      : t('sidebar.theme_light');
  if (iconOnly) {
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }

  if (!opts.themeMode) {
    setHtml(toggle, `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor"/></svg>`);
  } else if (opts.themeMode === 'dark') {
    setHtml(toggle, `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`);
  } else {
    setHtml(toggle, `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`);
  }
  if (!iconOnly) toggle.createSpan({ text: label });
}

/* ── SVG helper ──────────────────────────────────── */

/** Small padlock badge for locked Pro nav items. */
function createLockIcon(size: number): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-linecap', 'round');
  for (const d of ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function createSvgIcon(pathData: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-linecap', 'round');

  const segments = pathData.split(/(?=M)/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', trimmed);
    svg.appendChild(path);
  }

  return svg;
}
