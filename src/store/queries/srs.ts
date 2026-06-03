import { DataStore } from '../../storage/data-store';
import { SrsParams, BUILTIN_PRESETS, BUILTIN_INTENT_RECIPES } from '../../card/types';
import { intentToParams } from '../../srs/intent';
import { t, getLang } from '../../i18n';

/**
 * Resolve an override id to its SrsParams. The id can be an intent recipe id
 * (built-in or user) or a legacy preset id. Falls back to global default.
 */
export function resolvePresetParams(ds: DataStore, presetId: string): SrsParams {
  const settings = ds.getSettings();
  const recipes = [...BUILTIN_INTENT_RECIPES, ...(settings.userIntentRecipes ?? [])];
  const recipe = recipes.find(r => r.id === presetId);
  if (recipe) return intentToParams(recipe.intent);

  const allPresets = [...BUILTIN_PRESETS, ...(settings.customPresets ?? [])];
  const preset = allPresets.find(p => p.id === presetId);
  return preset?.params ?? ds.getSrsParams();
}

/** Display name for a deck's strategy override. */
export function resolveStrategyName(ds: DataStore, deckTag: string): string {
  const overrides = ds.getDeckSrsOverrides();
  const override = overrides[deckTag];
  if (!override) return t('srs.global_default');
  if (typeof override === 'string') {
    const settings = ds.getSettings();
    const recipes = [...BUILTIN_INTENT_RECIPES, ...(settings.userIntentRecipes ?? [])];
    const r = recipes.find(r => r.id === override);
    if (r) return getLang() === 'zh' ? r.nm : (r.nmEn ?? r.nm);

    const allPresets = [...BUILTIN_PRESETS, ...(settings.customPresets ?? [])];
    const p = allPresets.find(p => p.id === override);
    if (p) return getLang() === 'zh' ? p.name : p.nameEn;
    return t('srs.global_default');
  }
  return t('srs.custom_label');
}
