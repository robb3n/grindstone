import { TabContext } from './types';
import { t, getLang } from '../../i18n';
import {
  FAMILIES, METRIC_MAP, metricsByFamily,
} from '../../radar/metrics';
import {
  RadarFamily, RadarMetricKey,
} from '../../radar/types';
import { RADAR_PRESETS, DEFAULT_RADAR_DIMENSIONS } from '../../radar/presets';
import { renderRadarChart } from '../../radar/RadarChart';
import { computeRadarAxes, sanitizeDims } from '../../radar/render-helpers';
import { GrindstoneRadarView, WORKSPACE_VIEW_TYPE_RADAR } from '../../radar/RadarLeafView';

const MIN_DIMS = 3;
const SWEET_LO = 5;
const SWEET_HI = 7;
const MAX_DIMS = 9;
/** Below this leaf-page width, switch from split layout to tab-pill layout. */
const SPLIT_TO_TABS_THRESHOLD = 900;

type ViewMode = 'split' | 'tabs';
type TabsPanel = 'radar' | 'picker';

export function renderRadar(container: HTMLElement, ctx: TabContext): () => void {
  // ── Page head ──
  const head = container.createDiv({ cls: 'gs-pagehead' });
  const headL = head.createDiv({ cls: 'gs-pagehead-l' });
  headL.createEl('h1', { cls: 'gs-pagehead-title', text: t('nav.radar') });

  const headR = head.createDiv({ cls: 'gs-pagehead-r' });
  const presetWrap = headR.createDiv({ cls: 'rd-presets' });
  for (const preset of RADAR_PRESETS) {
    const btn = presetWrap.createEl('button', { cls: 'rd-preset-btn' });
    btn.createSpan({ cls: 'rd-preset-ico', text: preset.ico });
    btn.createSpan({ text: getLang() === 'zh' ? preset.name : preset.nameEn });
    btn.addEventListener('click', () => { void setDimensions([...preset.dimensions]); });
  }
  const clearBtn = headR.createEl('button', { cls: 'rd-preset-btn rd-preset-clear' });
  clearBtn.textContent = t('radar.clear');
  clearBtn.addEventListener('click', () => { void setDimensions([]); });

  // ── Page body ──
  const page = container.createDiv({ cls: 'gs-page rd-page' });

  // Initial dimensions — fall back to first preset if none stored
  const settings = ctx.store.getSettings();
  let dims: RadarMetricKey[] = sanitizeDims(
    settings.radarConfig?.dimensions ?? DEFAULT_RADAR_DIMENSIONS,
  );

  let viewMode: ViewMode = 'split';
  let tabsPanel: TabsPanel = 'radar';

  const setDimensions = async (next: RadarMetricKey[]): Promise<void> => {
    dims = sanitizeDims(next);
    await ctx.store.updateSettings({ radarConfig: { dimensions: dims } });
    repaint();
    for (const leaf of ctx.app.workspace.getLeavesOfType(WORKSPACE_VIEW_TYPE_RADAR)) {
      (leaf.view as GrindstoneRadarView).refresh();
    }
  };

  const toggleDim = (key: RadarMetricKey): void => {
    if (dims.includes(key)) {
      void setDimensions(dims.filter(d => d !== key));
    } else {
      if (dims.length >= MAX_DIMS) return;
      void setDimensions([...dims, key]);
    }
  };

  const repaint = (): void => {
    page.empty();
    page.toggleClass('rd-mode-split', viewMode === 'split');
    page.toggleClass('rd-mode-tabs', viewMode === 'tabs');

    if (viewMode === 'tabs') {
      renderPillSwitcher(page, tabsPanel, (next) => {
        if (tabsPanel === next) return;
        tabsPanel = next;
        repaint();
      });
    }

    const layout = page.createDiv({ cls: 'rd-layout' });

    if (viewMode === 'split') {
      const leftPane = layout.createDiv({ cls: 'rd-left' });
      const rightPane = layout.createDiv({ cls: 'rd-right' });
      renderPickerPane(leftPane, dims, toggleDim);
      renderPreviewPanel(rightPane, dims, ctx, toggleDim);
    } else {
      // tabs mode: only one of picker / preview at a time, both full-width
      if (tabsPanel === 'picker') {
        const pane = layout.createDiv({ cls: 'rd-left' });
        renderPickerPane(pane, dims, toggleDim);
      } else {
        const pane = layout.createDiv({ cls: 'rd-right' });
        renderPreviewPanel(pane, dims, ctx, toggleDim);
      }
    }
  };

  // ── Mode sync via ResizeObserver on the page element ──
  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const width = entry.contentRect.width;
    if (width <= 0) return;
    const nextMode: ViewMode = width < SPLIT_TO_TABS_THRESHOLD ? 'tabs' : 'split';
    if (nextMode === viewMode) return;
    viewMode = nextMode;
    repaint();
  });
  observer.observe(page);

  // First sync uses the synchronous width if available, then paint
  const initialWidth = page.getBoundingClientRect().width;
  viewMode = initialWidth > 0 && initialWidth < SPLIT_TO_TABS_THRESHOLD ? 'tabs' : 'split';
  repaint();

  return () => observer.disconnect();
}

function renderPillSwitcher(
  parent: HTMLElement,
  active: TabsPanel,
  onPick: (next: TabsPanel) => void,
): void {
  const pills = parent.createDiv({ cls: 'rd-pills' });
  const items: { id: TabsPanel; labelKey: 'radar.pill_radar' | 'radar.pill_picker' }[] = [
    { id: 'radar',  labelKey: 'radar.pill_radar' },
    { id: 'picker', labelKey: 'radar.pill_picker' },
  ];
  for (const item of items) {
    const btn = pills.createEl('button', {
      cls: `rd-pill${active === item.id ? ' rd-pill-on' : ''}`,
      text: t(item.labelKey),
    });
    btn.addEventListener('click', () => onPick(item.id));
  }
}

function renderPickerPane(
  pane: HTMLElement,
  dims: RadarMetricKey[],
  onToggle: (key: RadarMetricKey) => void,
): void {
  for (const fam of FAMILIES) {
    renderFamilyCard(pane, fam.id, dims, onToggle);
  }
}

/* ── Left pane: family cards ──────────────────────────────────── */

function renderFamilyCard(
  parent: HTMLElement,
  family: RadarFamily,
  dims: RadarMetricKey[],
  onToggle: (key: RadarMetricKey) => void,
): void {
  const meta = FAMILIES.find(f => f.id === family)!;
  const card = parent.createDiv({ cls: 'gs-card rd-family' });

  const head = card.createDiv({ cls: 'rd-family-head' });
  head.createSpan({ cls: 'rd-family-name', text: getLang() === 'zh' ? meta.name : meta.nameEn });
  head.createSpan({ cls: 'rd-family-tag', text: getLang() === 'zh' ? meta.tagline : meta.taglineEn });

  const list = card.createDiv({ cls: 'rd-metric-list' });
  for (const metric of metricsByFamily(family)) {
    const selected = dims.includes(metric.key);
    const row = list.createDiv({ cls: `rd-metric${selected ? ' rd-metric-on' : ''}` });
    row.addEventListener('click', () => onToggle(metric.key));

    row.createDiv({ cls: 'rd-metric-name', text: getLang() === 'zh' ? metric.label : metric.labelEn });
    row.createDiv({ cls: 'rd-metric-desc', text: getLang() === 'zh' ? metric.desc : metric.descEn });

    const badges = row.createDiv({ cls: 'rd-metric-badges' });
    const fit = badges.createSpan({ cls: `rd-badge rd-badge-fit-${metric.fit}` });
    fit.textContent = fitLabel(metric.fit);
    const feas = badges.createSpan({ cls: `rd-badge rd-badge-feas-${metric.feas}` });
    feas.textContent = metric.feas === 'yes' ? '✓' : '⚠';
  }
}

function fitLabel(fit: 'high' | 'med' | 'low'): string {
  if (getLang() === 'zh') return fit === 'high' ? '高' : fit === 'med' ? '中' : '低';
  return fit === 'high' ? 'H' : fit === 'med' ? 'M' : 'L';
}

/* ── Right pane: radar + chips + count ────────────────────────── */

function renderPreviewPanel(
  parent: HTMLElement,
  dims: RadarMetricKey[],
  ctx: TabContext,
  onToggle: (key: RadarMetricKey) => void,
): void {
  const panel = parent.createDiv({ cls: 'gs-card rd-preview' });

  // Header — title + count
  const head = panel.createDiv({ cls: 'rd-preview-head' });
  head.createDiv({ cls: 'rd-preview-title', text: t('radar.preview') });

  const countWrap = head.createDiv({ cls: 'rd-count' });
  countWrap.createSpan({ cls: 'rd-count-zh', text: t('radar.selected') });
  countWrap.createSpan({ cls: 'rd-count-num gs-mono', text: String(dims.length) });
  countWrap.createSpan({ cls: 'rd-count-zh', text: t('radar.selected_unit') });
  countWrap.createSpan({ cls: zoneClass(dims.length), text: zoneLabel(dims.length) });

  // Radar
  const chartWrap = panel.createDiv({ cls: 'rd-chart' });
  if (dims.length < MIN_DIMS) {
    chartWrap.createDiv({ cls: 'rd-chart-empty', text: t('radar.empty') });
  } else {
    const axes = computeRadarAxes(dims, ctx.store);
    chartWrap.appendChild(renderRadarChart(axes, { size: 380 }));
  }

  // Chips
  const chips = panel.createDiv({ cls: 'rd-chips' });
  if (dims.length === 0) {
    chips.createSpan({ cls: 'rd-chips-empty', text: t('radar.no_selection') });
  } else {
    for (const key of dims) {
      const metric = METRIC_MAP[key];
      if (!metric) continue;
      const chip = chips.createSpan({ cls: 'rd-chip' });
      chip.createSpan({ text: getLang() === 'zh' ? metric.label : metric.labelEn });
      chip.createSpan({ cls: 'rd-chip-x', text: '×' });
      chip.addEventListener('click', () => onToggle(key));
    }
  }

  // Hint
  const hint = panel.createDiv({ cls: 'rd-hint' });
  hint.createDiv({ text: t('radar.hint_1') });
  hint.createDiv({ text: t('radar.hint_2') });
  hint.createDiv({ text: t('radar.hint_3') });
}

function zoneClass(n: number): string {
  if (n === 0) return 'rd-zone-hidden';
  if (n >= SWEET_LO && n <= SWEET_HI) return 'rd-zone rd-zone-ok';
  if (n === SWEET_LO - 1 || n === SWEET_HI + 1) return 'rd-zone rd-zone-warn';
  return 'rd-zone rd-zone-bad';
}

function zoneLabel(n: number): string {
  if (n === 0) return '';
  if (n >= SWEET_LO && n <= SWEET_HI) return '· ' + t('radar.zone_ok');
  if (n === SWEET_LO - 1 || n === SWEET_HI + 1) return '· ' + t('radar.zone_warn');
  return '· ' + t('radar.zone_bad');
}

