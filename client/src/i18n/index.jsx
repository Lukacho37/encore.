import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import baseFr from './fr.js';
import baseEn from './en.js';
import areas from './areas/index.js';
import { storage } from '../storage.js';

/** Fusion profonde : les textes d'une zone complètent (ou précisent) ceux du dictionnaire principal. */
function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !('one' in v || 'other' in v)
      ? merge(base[k], v)
      : v;
  }
  return out;
}

const fr = areas.reduce((d, a) => merge(d, a.fr), baseFr);
const en = areas.reduce((d, a) => merge(d, a.en), baseEn);
const DICTS = { fr, en };
export const LANGS = [
  { id: 'fr', label: 'FR', name: 'Français' },
  { id: 'en', label: 'EN', name: 'English' },
];

const I18nContext = createContext(null);

function detect() {
  const saved = storage.get('albummania.lang');
  if (saved && DICTS[saved]) return saved;
  return (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => (node == null ? node : node[part]), dict);
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detect);

  const setLang = useCallback((next) => {
    if (!DICTS[next]) return;
    storage.set('albummania.lang', next);
    setLangState(next);
  }, []);

  // Langue de la page dès le premier rendu (lecteurs d'écran), puis à chaque changement.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    const dict = DICTS[lang];
    const plural = new Intl.PluralRules(lang);
    const numberFmt = new Intl.NumberFormat(lang);
    const dateFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' });
    // Intl.DisplayNames manque dans les moteurs anciens : on garde alors le code pays.
    const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([lang], { type: 'region' }) : { of: (code) => code };

    /** t('a.b', { n: 3 }) — gère les pluriels ({ one, other }) et l'interpolation {var}. */
    function t(key, vars = {}) {
      let entry = lookup(dict, key);
      if (entry == null) entry = lookup(fr, key);
      if (entry == null) return key;
      if (typeof entry === 'object' && !Array.isArray(entry) && ('one' in entry || 'other' in entry)) {
        const count = vars.n ?? vars.count ?? 0;
        entry = entry[plural.select(count)] ?? entry.other;
      }
      if (typeof entry !== 'string') return entry;
      return entry.replace(/\{(\w+)\}/g, (_, k) => {
        const v = vars[k];
        if (v == null) return '';
        return typeof v === 'number' && !['d', 'v', 'initial'].includes(k) && v >= 1000 ? numberFmt.format(v) : String(v);
      });
    }

    return {
      lang,
      setLang,
      t,
      num: (n) => numberFmt.format(n),
      date: (ms) => dateFmt.format(new Date(ms)),
      country: (code) => {
        try {
          return regions.of(code);
        } catch {
          return code;
        }
      },
      error: (code) => {
        const msg = lookup(dict.errors, code);
        return typeof msg === 'string' ? msg : dict.errors.server_error;
      },
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
