import { GrindstoneStore } from '../store/GrindstoneStore';
import { logicalNow } from '../util/date';
import { getLang } from '../i18n';
import { MetricCtx, RadarMetricKey } from './types';
import { METRIC_MAP, METRICS, FAMILIES } from './metrics';
import { RadarAxis } from './RadarChart';

const MAX_DIMS = 9;

const FAMILY_MAP = new Map(FAMILIES.map((f) => [f.id, f]));

export function buildMetricCtx(store: GrindstoneStore): MetricCtx {
  return {
    cards: store.getAllCardsMap(),
    reviewLogs: store.getRawReviewLogs(),
    settings: store.getSettings(),
    now: logicalNow(),
  };
}

export function computeRadarAxes(
  dims: readonly RadarMetricKey[],
  store: GrindstoneStore,
): RadarAxis[] {
  const mctx = buildMetricCtx(store);
  const lang = getLang();
  return dims.map((key) => {
    const metric = METRIC_MAP[key];
    if (!metric) return { label: String(key), value: 0, empty: true };
    const family = FAMILY_MAP.get(metric.family);
    const label = family
      ? (lang === 'zh' ? family.name : family.nameEn)
      : (lang === 'zh' ? metric.label : metric.labelEn);
    const value = metric.compute(mctx);
    return {
      label,
      value: value ?? 0,
      empty: value == null,
    };
  });
}

export function sanitizeDims(input: readonly string[]): RadarMetricKey[] {
  const known = new Set<string>(METRICS.map((m) => m.key));
  const seen = new Set<string>();
  const out: RadarMetricKey[] = [];
  for (const k of input) {
    if (!known.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k as RadarMetricKey);
    if (out.length >= MAX_DIMS) break;
  }
  return out;
}
