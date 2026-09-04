/**
 * THE LANDING KIT — the server-side furniture every band on `/landingpage` is built from.
 *
 * ── WHY THIS FILE IS NOT `"use client"` ─────────────────────────────────────────────────────────
 * The landing page is a SERVER component that mounts client islands, not a 3,000-line client bundle.
 * That is the whole reason `site/mockups.tsx` was written without a directive: the product visuals,
 * the copy and the tables all render on the server, and only the eight things that genuinely need a
 * browser — the scroll-driven figures, the tabs, the accordion, the filter — ship as JavaScript.
 *
 * The consequence, and it is the same one `mockups.tsx` calls out in its own header: a server module
 * may import a client COMPONENT (React hands it a reference and renders it at the boundary) but may
 * NOT import a client VALUE — `cx` or the `Icon` map out of `ui.tsx` would arrive as an opaque
 * client reference rather than a function or an element. So `cx` is redeclared here, one line of it,
 * and the two glyphs this file needs are written inline.
 *
 * ── HOUSE RULES OBSERVED ────────────────────────────────────────────────────────────────────────
 * Tokens only, never a raw colour, so every one of these survives being dropped inside `.on-ink`
 * with no second code path. Section rhythm is `.band`, measure is `.shell`, and every heading size
 * comes off the `.type-*` ramp in globals.css — a raw `text-[4rem]` on a section head is a
 * regression, because it will not step down on a tablet.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/ui";
import { getDictionary, lookup } from "@/i18n";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/**
 * The server-side twin of `useI18n().t`. `@/i18n` is plain data and pure functions, so a server
 * component can resolve copy without a provider and without pulling the page into the client graph.
 */
export function tFor(locale: string) {
  const dict = getDictionary(locale);
  return (path: string, params?: Record<string, string | number>) => lookup(dict, path, params);
}

/**
 * A major section. Three grounds and nothing else:
 *
 *   paper  the ground. The default, and the one most bands sit on.
 *   wash   one overlay step above it. Alternation, so two adjacent bands never merge.
 *   ink    `.on-ink` — the near-black MATERIAL. Reserved for machine-made evidence and for the two
 *          editorial destinations (the formula, the closing CTA). It is a stop, not a theme, so a
 *          page with five of them has none.
 */
export function Band({
  id,
  tone = "paper",
  tight,
  bleed,
  className,
  children,
}: {
  id?: string;
  tone?: "paper" | "wash" | "ink";
  tight?: boolean;
  /** Skip the `.shell` measure — for a figure that must reach the viewport edge. */
  bleed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cx(
        "relative scroll-mt-20 border-b border-line",
        tone === "ink" && "on-ink bg-paper text-ink",
        tone === "wash" && "bg-overlay-1",
        tight ? "band-tight" : "band",
        className,
      )}
    >
      {bleed ? children : <div className="shell">{children}</div>}
    </section>
  );
}

/**
 * The section head. One eyebrow, one heading off the ramp, one optional lede — revealed as a single
 * unit, because a kicker that arrives 60 ms before its own heading reads as a glitch rather than as
 * a stagger.
 */
export function Head({
  eyebrow,
  title,
  lede,
  center,
  wide,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  center?: boolean;
  /** Let the heading run to the full measure — for a two-word title that would otherwise widow. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <Reveal className={className}>
      <div className={cx(center && "mx-auto text-center")}>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className={cx("type-section", eyebrow && "mt-4", !wide && "max-w-[19ch]", center && "mx-auto")}>{title}</h2>
        {lede && <p className={cx("type-lede mt-6 max-w-[62ch]", center && "mx-auto")}>{lede}</p>}
      </div>
    </Reveal>
  );
}

/** A caption under a figure. Machine-made captions are mono; this one is prose, so it is not. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("type-meta mt-4", className)}>{children}</p>;
}

/**
 * The editorial aside: a claim the page wants to make in its own voice, set against a brass rail
 * because it is the system speaking rather than the narrator.
 */
export function Rule({ children, tone = "brass" }: { children: ReactNode; tone?: "brass" | "verdigris" | "oxide" }) {
  return (
    <p
      className={cx(
        "rounded-[var(--radius-field)] border-l-2 px-5 py-4 text-[0.9375rem] leading-[1.6] text-ink-2",
        tone === "brass" && "border-brass bg-brass-soft/35",
        tone === "verdigris" && "border-verdigris bg-verdigris-soft/35",
        tone === "oxide" && "border-oxide bg-oxide-soft/35",
      )}
    >
      {children}
    </p>
  );
}

/** A card that rests on the ground and lifts one overlay step under the pointer. Never darkens. */
export const CARD =
  "rounded-[var(--radius-card)] border border-line bg-paper transition-[border-color,background-color] duration-150 ease-out hover:border-line-strong hover:bg-overlay-1";

/** The tick used wherever a list is a list of things that passed. Written inline: see the header. */
export function Tick({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid h-[1.125rem] w-[1.125rem] shrink-0 place-items-center rounded-[var(--radius-pill)] border border-verdigris-line bg-verdigris-soft text-[0.625rem] font-semibold leading-none text-verdigris",
        className,
      )}
    >
      ✓
    </span>
  );
}

/** The numbered pip on an ordered rail. Mono, tabular, brass — a step index is machine-made. */
export function Pip({ n, tone = "brass" }: { n: ReactNode; tone?: "brass" | "ink" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-pill)] border font-mono text-[0.75rem] font-medium leading-none tnum",
        tone === "brass" ? "border-brass-line bg-brass-soft text-brass-deep" : "border-line bg-overlay-2 text-ink-2",
      )}
    >
      {n}
    </span>
  );
}

/**
 * A call to action that is a LINK, because it navigates.
 *
 * `ui.tsx` exports a `Button`, and the console wraps it in a `Link` — which nests a `<button>`
 * inside an `<a>`. That is invalid content and it gives a screen reader two controls where the page
 * has one, so the marketing layer takes the styling and leaves the semantics alone. The class
 * strings below are `Button`'s own `primary` / `secondary` variants at `size="lg"`, kept in step
 * with it by hand rather than by importing a value out of a client module.
 */
export function LinkButton({
  href,
  variant = "secondary",
  size = "lg",
  className,
  children,
}: {
  href: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-pill)] font-medium",
        "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out",
        size === "lg" && "px-6 py-3.5 text-[0.9375rem] tracking-[-0.005em]",
        size === "md" && "px-4 py-2.5 text-[0.9375rem]",
        size === "sm" && "px-3 py-1.5 text-[0.8125rem]",
        variant === "primary" && "bg-ink text-paper hover:bg-ink-2 active:translate-y-px",
        variant === "secondary" && "border border-line bg-paper text-ink hover:border-line-strong hover:bg-paper-2 active:translate-y-px active:bg-paper-3",
        variant === "ghost" && "text-ink-2 hover:bg-overlay-2 hover:text-ink active:translate-y-px",
        className,
      )}
    >
      {children}
      <span aria-hidden>→</span>
    </Link>
  );
}
