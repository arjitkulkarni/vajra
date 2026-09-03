"use client";

/**
 * A segmented control, not a dropdown: three languages is few enough that the choice and the
 * current state should both be visible without a click. The track is a single overlay step above
 * the ground; the selected segment is the only brass in the header apart from the mark, because
 * brass carries agency and choosing your language is an action, not a state.
 */
import { usePathname, useRouter } from "next/navigation";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n";
import { useI18n } from "@/lib/i18n-client";
import { cx } from "./ui";

export function LocaleSwitcher({ compact }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (next: Locale) => {
    document.cookie = `vajra_locale=${next}; path=/; max-age=31536000; samesite=lax`;
    const parts = (pathname ?? "/en").split("/");
    parts[1] = next;
    router.push(parts.join("/") || `/${next}`);
  };

  return (
    <div
      className={cx(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-overlay-1 p-0.5",
        compact && "text-[0.75rem]",
      )}
      role="group"
      aria-label={t("nav.language")}
    >
      {LOCALES.map((l) => {
        const current = l === locale;
        return (
          <button
            key={l}
            onClick={() => switchTo(l)}
            aria-current={current ? "true" : undefined}
            className={cx(
              "rounded-[var(--radius-panel)] px-2.5 py-1 text-[0.8125rem] font-medium leading-none transition-[color,background-color] duration-150 ease-out active:translate-y-px",
              current ? "bg-brass-soft text-brass-deep" : "text-ink-3 hover:bg-overlay-2 hover:text-ink",
            )}
          >
            {LOCALE_NAMES[l]}
          </button>
        );
      })}
    </div>
  );
}
