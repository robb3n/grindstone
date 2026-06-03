import { ItemView, Plugin, WorkspaceLeaf } from 'obsidian';
import { GrindstoneStore } from '../store/GrindstoneStore';
import { renderRadarChart } from './RadarChart';
import { computeRadarAxes, sanitizeDims } from './render-helpers';
import { LicenseManager } from '../license';
import { renderInlineLocked } from '../view/license-teaser';
import { t } from '../i18n';

export const WORKSPACE_VIEW_TYPE_RADAR = 'grindstone-radar';

const MIN_DIMS = 3;
const DEFAULT_SIZE = 320;
const MIN_SIZE = 220;
const MAX_SIZE = 720;
const CONTAINER_PADDING = 4;

export class GrindstoneRadarView extends ItemView {
  private resizeObserver: ResizeObserver | null = null;
  private chartContainer!: HTMLElement;
  private store: GrindstoneStore;
  private license: LicenseManager;

  constructor(leaf: WorkspaceLeaf, store: GrindstoneStore, license: LicenseManager) {
    super(leaf);
    this.store = store;
    this.license = license;
  }

  getViewType(): string {
    return WORKSPACE_VIEW_TYPE_RADAR;
  }

  getDisplayText(): string {
    return t('radar.leaf_title');
  }

  getIcon(): string {
    return 'hexagon';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('gs-radar-leaf');
    this.chartContainer = container.createDiv({ cls: 'gs-radar-leaf-inner' });
    this.render();

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.chartContainer);
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.contentEl.empty();
  }

  refresh(): void {
    if (this.chartContainer) this.render();
  }

  private render(): void {
    this.chartContainer.empty();

    // Pro gate — radar leaf is one of radar's three independent draw paths.
    if (!this.license.canUseTab('radar')) {
      renderInlineLocked(this.chartContainer);
      return;
    }

    const dims = sanitizeDims(this.store.getSettings().radarConfig?.dimensions ?? []);
    if (dims.length < MIN_DIMS) {
      this.chartContainer.createDiv({
        cls: 'gs-radar-leaf-empty',
        text: t('radar.embed_empty'),
      });
      return;
    }

    const rect = this.chartContainer.getBoundingClientRect();
    const w = rect.width - CONTAINER_PADDING * 2;
    const h = rect.height - CONTAINER_PADDING * 2;
    const measured = Math.min(w > 0 ? w : DEFAULT_SIZE, h > 0 ? h : DEFAULT_SIZE);
    const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, measured || DEFAULT_SIZE));

    const axes = computeRadarAxes(dims, this.store);
    this.chartContainer.appendChild(renderRadarChart(axes, { size }));
  }
}

export function registerRadarCodeBlock(
  plugin: Plugin,
  store: GrindstoneStore,
  license: LicenseManager,
): void {
  plugin.registerMarkdownCodeBlockProcessor('grindstone-radar', (source, el) => {
    el.addClass('gs-radar-embed');
    const inner = el.createDiv({ cls: 'gs-radar-embed-inner' });
    // Pro gate — locked → one-line placeholder (spec §6).
    if (!license.canUseTab('radar')) {
      renderInlineLocked(inner);
      return;
    }
    const dims = sanitizeDims(store.getSettings().radarConfig?.dimensions ?? []);
    if (dims.length < MIN_DIMS) {
      inner.createDiv({ cls: 'gs-radar-embed-empty', text: t('radar.embed_empty') });
      return;
    }
    const size = parseEmbedSize(source) ?? 320;
    const axes = computeRadarAxes(dims, store);
    inner.appendChild(renderRadarChart(axes, { size }));
  });
}

function parseEmbedSize(source: string): number | null {
  const match = source.match(/^\s*size\s*:\s*(\d+)\s*$/m);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}
