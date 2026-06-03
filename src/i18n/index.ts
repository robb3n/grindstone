import { STRINGS_ZH, STRINGS_EN } from './strings';

export type Lang = 'zh' | 'en';
export type StringKey = keyof typeof STRINGS_ZH;

let currentLang: Lang = detectInitial();

function detectInitial(): Lang {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

export function detectSystemLang(): Lang {
  return detectInitial();
}

export function setLang(lang: Lang): void {
  currentLang = lang;
}

export function getLang(): Lang {
  return currentLang;
}

const DICTS: Record<Lang, Record<string, string>> = {
  zh: STRINGS_ZH,
  en: STRINGS_EN,
};

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const dict = DICTS[currentLang];
  const raw = dict[key] ?? STRINGS_EN[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v == null ? `{${k}}` : String(v);
  });
}
