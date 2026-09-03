"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatBytes, formatDateTime, formatNumber, formatRelative, formatTime, getDictionary, lookup, type Dictionary, type Locale } from "@/i18n";

interface I18nValue {
  locale: Locale;
  dict: Dictionary;
  t: (path: string, params?: Record<string, string | number>) => string;
  n: (value: number, options?: Intl.NumberFormatOptions) => string;
  dt: (iso: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  time: (iso: string | Date) => string;
  rel: (iso: string | Date) => string;
  bytes: (n: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const dict = getDictionary(locale);
  const value: I18nValue = {
    locale,
    dict,
    t: (path, params) => lookup(dict, path, params),
    n: (v, options) => formatNumber(locale, v, options),
    dt: (iso, options) => formatDateTime(locale, iso, options),
    time: (iso) => formatTime(locale, iso),
    rel: (iso) => formatRelative(locale, iso, dict.common.justNow),
    bytes: (n) => formatBytes(locale, n),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
