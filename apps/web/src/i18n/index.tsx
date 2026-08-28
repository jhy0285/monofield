'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { en } from './locales/en';
import { ko } from './locales/ko';
import { zhCN } from './locales/zh-CN';
import { getOpenDesignHost } from '@open-design/host';
import { LOCALES, type Dict, type Locale } from './types';

export { LOCALES, LOCALE_LABEL } from './types';
export type { Locale } from './types';

type DictKey = keyof Dict;

// Keep the most common bundled locales synchronous so first paint never
// flashes another language for English/Korean/Chinese users. The other
// dictionaries are large (~250 KB source each), so loading all 19 before the
// home screen made the initial locale chunk roughly 5 MB. Dynamic imports keep
// every locale available while moving uncommon dictionaries off the startup
// path.
const LOADED_DICTS = new Map<Locale, Dict>([
  ['en', en],
  ['ko', ko],
  ['zh-CN', zhCN],
]);

const DICT_LOADERS: Partial<Record<Locale, () => Promise<Dict>>> = {
  id: () => import('./locales/id').then((module) => module.id),
  de: () => import('./locales/de').then((module) => module.de),
  'zh-TW': () => import('./locales/zh-TW').then((module) => module.zhTW),
  'pt-BR': () => import('./locales/pt-BR').then((module) => module.ptBR),
  'es-ES': () => import('./locales/es-ES').then((module) => module.esES),
  ru: () => import('./locales/ru').then((module) => module.ru),
  fa: () => import('./locales/fa').then((module) => module.fa),
  ar: () => import('./locales/ar').then((module) => module.ar),
  ja: () => import('./locales/ja').then((module) => module.ja),
  pl: () => import('./locales/pl').then((module) => module.pl),
  hu: () => import('./locales/hu').then((module) => module.hu),
  fr: () => import('./locales/fr').then((module) => module.fr),
  uk: () => import('./locales/uk').then((module) => module.uk),
  tr: () => import('./locales/tr').then((module) => module.tr),
  th: () => import('./locales/th').then((module) => module.th),
  it: () => import('./locales/it').then((module) => module.it),
};
const DICT_LOAD_PROMISES = new Map<Locale, Promise<Dict>>();

function loadLocaleDict(locale: Locale): Promise<Dict> {
  const loaded = LOADED_DICTS.get(locale);
  if (loaded) return Promise.resolve(loaded);
  const pending = DICT_LOAD_PROMISES.get(locale);
  if (pending) return pending;
  const loader = DICT_LOADERS[locale];
  if (!loader) return Promise.resolve(en);
  const promise = loader()
    .then((dict) => {
      LOADED_DICTS.set(locale, dict);
      DICT_LOAD_PROMISES.delete(locale);
      return dict;
    })
    .catch((error) => {
      DICT_LOAD_PROMISES.delete(locale);
      throw error;
    });
  DICT_LOAD_PROMISES.set(locale, promise);
  return promise;
}

const LS_KEY = 'open-design:locale';
// Marker that says "the value in LS_KEY came from a deliberate user
// action through setLocale, not from some auto-detection path". Only
// values tagged this way win over the desktop host's injected OS
// locale, so a stale auto-detected pick can't pin the app forever once
// the user changes their system language.
const LS_SOURCE_KEY = 'open-design:locale-source';
const MANUAL_LOCALE_SOURCE = 'manual';

export function resolveSystemLocale(languages: readonly string[]): Locale | null {
  const supported = LOCALES as readonly string[];
  for (const raw of languages) {
    const normalized = raw.trim();
    if (!normalized) continue;

    const exact = LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;

    const [language, regionOrScript] = normalized.toLowerCase().split('-');
    if (language === 'zh') {
      if (regionOrScript === 'hant' || regionOrScript === 'tw' || regionOrScript === 'hk' || regionOrScript === 'mo') {
        return 'zh-TW';
      }
      return 'zh-CN';
    }

    const baseMatch = LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === language);
    if (baseMatch && supported.includes(baseMatch)) return baseMatch;
  }
  return null;
}

// Read the OS locale the desktop host attached to its client descriptor.
// Packaged desktop builds need this because Chromium otherwise reports
// en-US through navigator.language regardless of the OS setting. We go
// through `getOpenDesignHost` rather than reading the bridge global by
// name so the web/preload boundary stays single-source (see the
// `host bridge boundary` guard test).
function readDesktopHostOsLocale(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = getOpenDesignHost();
  const value = host?.client?.osLocale;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// First-run defaults to the user's OS / browser language when possible.
// Priority: explicit user pick saved to localStorage (only when tagged
// as manual) > OS locale that the desktop host injected (packaged
// Electron) > navigator.languages > 'en'. The source tag matters
// because untagged localStorage values are treated as legacy /
// auto-detected — they don't override a fresh OS locale read.
// Exported so tests can pin the priority chain without spinning up the
// full I18nProvider.
export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  let storedLocale: string | null = null;
  let storedSource: string | null = null;
  try {
    storedLocale = window.localStorage.getItem(LS_KEY);
    storedSource = window.localStorage.getItem(LS_SOURCE_KEY);
  } catch {
    /* ignore */
  }
  if (
    storedSource === MANUAL_LOCALE_SOURCE &&
    storedLocale &&
    (LOCALES as string[]).includes(storedLocale)
  ) {
    return storedLocale as Locale;
  }
  const hostOsLocale = readDesktopHostOsLocale();
  if (hostOsLocale) {
    const fromHost = resolveSystemLocale([hostOsLocale]);
    if (fromHost) return fromHost;
  }
  const detected = resolveSystemLocale(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
  return detected ?? 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface ProviderProps {
  initial?: Locale;
  children: ReactNode;
}

const RTL_LOCALES: Locale[] = ['ar', 'fa'];

export function I18nProvider({ initial, children }: ProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectInitialLocale());
  const [dictRevision, setDictRevision] = useState(0);
  const requestedLocaleRef = useRef(locale);

  useEffect(() => {
    requestedLocaleRef.current = locale;
    if (LOADED_DICTS.has(locale)) return;
    let active = true;
    void loadLocaleDict(locale)
      .then(() => {
        if (active) setDictRevision((revision) => revision + 1);
      })
      .catch(() => {
        // English remains the safe fallback if a split locale chunk cannot
        // be loaded. A later explicit language selection retries the import.
      });
    return () => {
      active = false;
    };
  }, [locale]);

  // Keep <html lang="…" dir="…"> in sync so screen readers and CSS hooks
  // pick the right language token and direction without each component
  // having to set it itself.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
      document.documentElement.setAttribute('lang', locale);
      document.documentElement.setAttribute('dir', dir);
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    requestedLocaleRef.current = next;
    try {
      window.localStorage.setItem(LS_KEY, next);
      // Marker so detectInitialLocale knows this came from a deliberate
      // user action and should beat the desktop host's OS locale.
      window.localStorage.setItem(LS_SOURCE_KEY, MANUAL_LOCALE_SOURCE);
    } catch {
      /* ignore */
    }
    if (LOADED_DICTS.has(next)) {
      setLocaleState(next);
      return;
    }
    void loadLocaleDict(next)
      .then(() => {
        if (requestedLocaleRef.current === next) setLocaleState(next);
      })
      .catch(() => {
        if (requestedLocaleRef.current === next) setLocaleState(next);
      });
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>): string => {
      const dict = LOADED_DICTS.get(locale) ?? en;
      const raw = dict[key] ?? en[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
        const v = vars[name];
        return v == null ? `{${name}}` : String(v);
      });
    },
    [dictRevision, locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fall back to a stand-alone English translator when no provider is
    // mounted (e.g. an isolated test). This keeps the API safe to call
    // without requiring every callsite to wrap in a provider.
    return {
      locale: 'en',
      setLocale: () => { },
      t: (key, vars) => {
        const raw = en[key] ?? key;
        if (!vars) return raw;
        return raw.replace(/\{(\w+)\}/g, (_, n: string) => {
          const v = vars[n];
          return v == null ? `{${n}}` : String(v);
        });
      },
    };
  }
  return ctx;
}

// Convenience for components that only need the translator function.
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
