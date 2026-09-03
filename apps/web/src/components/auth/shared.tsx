"use client";

/** Small pieces both auth flows need, kept in one place so the two read the same. */
import type { ReactNode } from "react";
import { GATEWAY, GatewayError } from "@/lib/api";
import { cx } from "@/components/ui";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Prefer the dictionary's wording for a known gateway code; fall back to whatever we were told.
 *
 * The params matter: `errors.network` carries a {url}, and a message that shows the placeholder
 * instead of the address is worse than no message — the one thing the reader needs is where we
 * tried to reach. `lookup()` returns the dotted path when a key is missing, which is how an
 * untranslated code is detected here.
 */
export function describeError(e: unknown, t: Translate): string {
  if (e instanceof GatewayError) {
    const key = `errors.${e.code}`;
    const translated = t(key, { url: GATEWAY });
    return translated === key ? e.message : translated;
  }
  return (e as Error).message;
}

/**
 * Three banner tones, each an alpha wash of its own hue with a matching rim — never a pastel fill,
 * which on near-black would read as a lightbulb rather than as a tint.
 *
 * The glyph is not decoration. Colour alone cannot carry a state here: these notes are frequently
 * the ONLY thing on screen after a failed liveness check, they get read on a projector at the back
 * of a room, and saffron is optically louder than oxide — so a warning can out-shout a refusal on
 * fill alone. ✗ / ⚠ / ✓ fix the severity order independently of hue, and stay aria-hidden so the
 * message is announced once, as words.
 */
const TONES = {
  bad: { skin: "border-oxide-line bg-oxide-soft text-oxide", glyph: "✗" },
  warn: { skin: "border-saffron-line bg-saffron-soft text-saffron", glyph: "⚠" },
  good: { skin: "border-verdigris-line bg-verdigris-soft text-verdigris", glyph: "✓" },
} as const;

export function AuthNote({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : undefined}
      className={cx(
        "auth-panel flex items-start gap-2.5 rounded-[var(--radius-field)] border px-3.5 py-2.5 text-[0.875rem] leading-relaxed",
        TONES[tone].skin,
      )}
    >
      <span aria-hidden className="mt-px shrink-0 leading-relaxed">
        {TONES[tone].glyph}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}
