import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { zhTW, type Dict, type TKey } from "./locales/zh-TW";
import { en } from "./locales/en";
import { ja } from "./locales/ja";

export type Lang = "zh-TW" | "en" | "ja";

const DICTS: Record<Lang, Dict> = { "zh-TW": zhTW, en, ja };
const STORAGE_KEY = "deltascope.lang";
const LANGS: Lang[] = ["zh-TW", "en", "ja"];

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.includes(saved as Lang)) return saved as Lang;
  } catch {
    // localStorage 不可用時忽略,落到系統偵測
  }
  const sys = (navigator.language || "").toLowerCase();
  if (sys.startsWith("zh")) return "zh-TW";
  if (sys.startsWith("ja")) return "ja";
  return "en";
}

// 依 "group.key" 取字典字串;缺字 fallback 到 zh-TW。
function lookup(dict: Dict, key: TKey): string {
  const [group, k] = key.split(".") as [keyof Dict, string];
  const g = dict[group] as Record<string, string> | undefined;
  const val = g?.[k];
  if (typeof val === "string") return val;
  const fb = (zhTW[group] as Record<string, string> | undefined)?.[k];
  return fb ?? key;
}

// {name} 佔位插值。
function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, name) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, params?: Record<string, string | number>) => string;
};

const LangContext = createContext<I18nValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // 忽略寫入失敗
    }
  }, []);

  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) =>
      interpolate(lookup(DICTS[lang], key), params),
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return createElement(LangContext.Provider, { value }, children);
}

export function useI18n(): I18nValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useI18n must be used within <LangProvider>");
  return ctx;
}
