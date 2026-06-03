/**
 * Pure SVG radar chart renderer. Takes labels + values (0..1 each) and paints
 * a polygon with concentric grid rings. No persistence, no metric semantics —
 * the caller resolves dimensions to {label, value} pairs.
 */

export interface RadarAxis {
  label: string;
  value: number;      // 0..1
  /** When true, this axis has no data — render as a hollow ring marker. */
  empty?: boolean;
}

export interface RadarChartOptions {
  size: number;          // viewBox width/height (square)
  rings?: number[];      // grid ring ratios (default: 0.25, 0.5, 0.75, 1.0)
  /** Animation delay before the data polygon expands (ms). */
  animDelay?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export function renderRadarChart(
  axes: RadarAxis[],
  opts: RadarChartOptions,
): SVGElement {
  const { size, rings = [0.2, 0.4, 0.6, 0.8, 1.0], animDelay = 80 } = opts;
  const cx = size / 2;
  const cy = size / 2;

  // Responsive label sizing — labels are short ZH dimension names (2-3 chars,
  // ~24-30px wide) so the reserved box stays tight. Long EN words may overflow
  // the box outward; foreignObject overflow="visible" lets them render.
  const labelScale = Math.max(0.7, Math.min(1, size / 380));
  const LABEL_W = Math.round(36 * labelScale);
  const LABEL_H = Math.round(30 * labelScale);
  const LABEL_GAP = Math.round(6 * labelScale);
  const fontPx = (12 * labelScale).toFixed(1);
  const pillFontPx = (10.5 * labelScale).toFixed(1);

  // labelPad just needs to fit a side-cluster label (gap + width) within viewBox.
  const labelPad = LABEL_W + LABEL_GAP;
  const R = (size - labelPad * 2) / 2;
  const n = axes.length;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.classList.add('gs-radar-svg');

  if (n < 3) {
    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', String(cx));
    txt.setAttribute('y', String(cy));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('dominant-baseline', 'middle');
    txt.setAttribute('fill', 'var(--gs-ink-3)');
    txt.setAttribute('font-size', '13');
    txt.textContent = '至少选 3 个维度才能画雷达';
    svg.appendChild(txt);
    return svg;
  }

  // ── Defs: gradients + filters for theme-aware glow polygon ──
  // CSS picks orange (light) or cyan (dark) gradient via .theme-light/.theme-dark.
  const el = (tag: string, attrs: Record<string, string>): SVGElement => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const defs = el('defs', {});
  for (const [gradId, stops] of [
    ['gs-radar-glow-orange', [
      ['0%',   '#fed7aa', '.7'],
      ['55%',  '#fb923c', '.45'],
      ['100%', '#c2410c', '.22'],
    ]],
    ['gs-radar-glow-cyan', [
      ['0%',   '#7df9ff', '.55'],
      ['60%',  '#00d4ff', '.32'],
      ['100%', '#0091b8', '.18'],
    ]],
  ] as const) {
    const grad = el('radialGradient', { id: gradId, cx: '50%', cy: '50%', r: '60%' });
    for (const [offset, color, opacity] of stops) {
      grad.appendChild(el('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    }
    defs.appendChild(grad);
  }
  for (const [filterId, stdDev] of [
    ['gs-radar-glow-blur',     '2.4'],
    ['gs-radar-glow-blur-dot', '1.6'],
  ] as const) {
    const filter = el('filter', { id: filterId, x: '-50%', y: '-50%', width: '200%', height: '200%' });
    filter.appendChild(el('feGaussianBlur', { stdDeviation: stdDev }));
    const merge = el('feMerge', {});
    merge.appendChild(el('feMergeNode', {}));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    filter.appendChild(merge);
    defs.appendChild(filter);
  }
  svg.appendChild(defs);

  const angles = Array.from({ length: n }, (_, i) =>
    -Math.PI / 2 + (i * 2 * Math.PI) / n,
  );

  // ── Grid rings ──
  for (let r = 0; r < rings.length; r++) {
    const ratio = rings[r];
    const pts = angles
      .map(a => `${cx + Math.cos(a) * R * ratio},${cy + Math.sin(a) * R * ratio}`)
      .join(' ');
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', pts);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'var(--text-muted)');
    poly.setAttribute('stroke-opacity', '0.22');
    poly.setAttribute('stroke-width', r === rings.length - 1 ? '1.2' : '0.8');
    svg.appendChild(poly);
  }

  // ── Axis lines ──
  for (const a of angles) {
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(cx));
    line.setAttribute('y1', String(cy));
    line.setAttribute('x2', String(x));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'var(--text-muted)');
    line.setAttribute('stroke-opacity', '0.16');
    line.setAttribute('stroke-width', '0.8');
    svg.appendChild(line);
  }

  // ── Data polygon ──
  // Animate from center: start with all values at 0, then expand to target.
  const startPts = angles.map(a => `${cx + Math.cos(a) * 0},${cy + Math.sin(a) * 0}`).join(' ');
  const targetPts = axes.map((axis, i) => {
    const v = axis.empty ? 0 : Math.max(0, Math.min(1, axis.value));
    const a = angles[i];
    return `${cx + Math.cos(a) * R * v},${cy + Math.sin(a) * R * v}`;
  }).join(' ');

  const fill = document.createElementNS(SVG_NS, 'polygon');
  fill.setAttribute('points', startPts);
  fill.classList.add('gs-radar-fill');
  fill.style.transition = 'all .9s cubic-bezier(.215,.61,.355,1)';
  svg.appendChild(fill);

  // ── Data points ──
  const dots: { el: SVGCircleElement; tx: number; ty: number }[] = [];
  axes.forEach((axis, i) => {
    const v = axis.empty ? 0 : Math.max(0, Math.min(1, axis.value));
    const a = angles[i];
    const x = cx + Math.cos(a) * R * v;
    const y = cy + Math.sin(a) * R * v;
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', axis.empty ? '4' : '3.5');
    dot.classList.add(axis.empty ? 'gs-radar-dot-empty' : 'gs-radar-dot');
    dot.style.transition = 'all .9s cubic-bezier(.215,.61,.355,1)';
    svg.appendChild(dot);
    dots.push({ el: dot, tx: x, ty: y });
  });

  // ── Axis labels (foreignObject so long labels wrap) ──
  axes.forEach((axis, i) => {
    const a = angles[i];
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const edgeX = cx + cosA * R;
    const edgeY = cy + sinA * R;

    let fx: number, fy: number;
    let alignSide: 'left' | 'center' | 'right';
    if (cosA > 0.3) {
      // Right cluster — anchor label to chart-facing (left) edge of box
      fx = edgeX + LABEL_GAP;
      fy = edgeY - LABEL_H / 2;
      alignSide = 'left';
    } else if (cosA < -0.3) {
      // Left cluster — anchor label to chart-facing (right) edge of box
      fx = edgeX - LABEL_GAP - LABEL_W;
      fy = edgeY - LABEL_H / 2;
      alignSide = 'right';
    } else if (sinA < 0) {
      // Top
      fx = edgeX - LABEL_W / 2;
      fy = edgeY - LABEL_GAP - LABEL_H;
      alignSide = 'center';
    } else {
      // Bottom
      fx = edgeX - LABEL_W / 2;
      fy = edgeY + LABEL_GAP;
      alignSide = 'center';
    }

    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('x', String(fx));
    fo.setAttribute('y', String(fy));
    fo.setAttribute('width', String(LABEL_W));
    fo.setAttribute('height', String(LABEL_H));
    fo.setAttribute('overflow', 'visible');

    const wrap = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
    wrap.className = `gs-radar-label gs-radar-label-${alignSide}`;
    wrap.style.fontSize = `${fontPx}px`;

    const name = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
    name.className = 'gs-radar-label-name';
    name.textContent = axis.label;

    const pill = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
    pill.className = 'gs-radar-label-pill gs-mono';
    pill.style.fontSize = `${pillFontPx}px`;
    const v = axis.empty ? null : Math.round((axis.value ?? 0) * 100);
    pill.textContent = v == null ? '—' : `${v}`;

    wrap.append(name, pill);
    fo.appendChild(wrap);
    svg.appendChild(fo);
  });

  // Kick off animations
  window.setTimeout(() => {
    if (!svg.isConnected) return;
    fill.setAttribute('points', targetPts);
    for (const d of dots) {
      d.el.setAttribute('cx', String(d.tx));
      d.el.setAttribute('cy', String(d.ty));
    }
  }, animDelay);

  return svg;
}
