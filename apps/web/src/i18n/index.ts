import { en, type Dictionary } from "./en";
import { hi } from "./hi";
import { kn } from "./kn";

export const LOCALES = ["en", "hi", "kn"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const DICTS: Record<Locale, Dictionary> = { en, hi, kn };

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" };

export function getDictionary(locale: string | undefined): Dictionary {
  return DICTS[(locale ?? DEFAULT_LOCALE) as Locale] ?? en;
}

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export type { Dictionary };

/** Fill {placeholders}. Missing values are left visible rather than silently dropped. */
export function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/**
 * Walk a dotted path; returns the path itself when a key is missing, so gaps are visible in review.
 *
 * Not every group nests. `actions` keys on dotted literals — `"asset.download"` — because the value
 * it is looked up by is itself a dotted action name, and splitting a path blindly on every dot walks
 * straight past those into `undefined`, which is why every action label in the console rendered as
 * the raw string `actions.asset.download`. So at each step take the longest remaining run of
 * segments that actually exists as a key, and only then descend.
 */
export function lookup(dict: Dictionary, path: string, params?: Record<string, string | number>): string {
  const segments = path.split(".");
  let node: unknown = dict;
  for (let i = 0; i < segments.length; i++) {
    if (!node || typeof node !== "object") return path;
    const record = node as Record<string, unknown>;
    let matched = false;
    for (let end = segments.length; end > i; end--) {
      const key = segments.slice(i, end).join(".");
      if (key in record) {
        node = record[key];
        i = end - 1;
        matched = true;
        break;
      }
    }
    if (!matched) return path;
  }
  return typeof node === "string" ? fill(node, params) : path;
}

// ─── Intl helpers, always locale-aware ───────────────────────────────────────

const INTL_LOCALE: Record<Locale, string> = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

export const formatNumber = (locale: Locale, n: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], options).format(n);

export const formatDateTime = (locale: Locale, iso: string | Date, options?: Intl.DateTimeFormatOptions): string => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], options ?? { dateStyle: "medium", timeStyle: "short" }).format(d);
};

export const formatTime = (locale: Locale, iso: string | Date): string =>
  formatDateTime(locale, iso, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function formatRelative(locale: Locale, iso: string | Date, justNow: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  if (abs < 45_000) return justNow;
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  return rtf.format(Math.round(diffMs / 1000), "second");
}

export function formatBytes(locale: Locale, bytes: number): string {
  if (bytes < 1024) return `${formatNumber(locale, bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(locale, bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  return `${formatNumber(locale, bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}
