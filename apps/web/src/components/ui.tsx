"use client";

/**
 * The VAJRA component set. Small, composable, no library.
 * Semantics never rely on colour alone: every state carries an icon and a word.
 *
 * DAYLIGHT NOTES
 * - Radii come from the ramp: tag/panel for instrument surfaces, control/field/card/media/frame
 *   for the editorial layer. Nothing is sharp and nothing is a literal any more.
 * - Elevation is a wash of ink over the ground (overlay-1..4 / paper-2 / paper-3), never a second
 *   solid grey. Only a floating surface (Dialog) reaches paper-raised + shadow-float.
 * - Every interactive element carries hover (darken one step, never lighten), active
 *   (translate-y-px) and focus (the global 2px brass outline plus its shadow-arc rim).
 * - The primary action is INK, not brass. Blue fills nothing; it rings, links and marks active.
 * - Transitions name their properties. Never `all`.
 * - Anything here dropped inside `.on-ink` re-grounds itself against near-black with no variant,
 *   because every token it reads is redefined for that scope in globals.css.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n-client";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** The one transition string every small control shares: explicit properties, 150ms, colour curve. */
const TRANSITION = "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out";

// ─── Motion helpers ──────────────────────────────────────────────────────────

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setTimeout(() => setShown(true), delay);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  // .reveal and its [data-shown] contract live in globals.css and are covered by the exhaustive
  // reduced-motion block. The compositor hint is dropped once the element has arrived, so a long
  // page does not hold one layer per revealed section for the rest of the session.
  return (
    <div ref={ref} className={cx("reveal", !shown && "will-change-[opacity,transform]", className)} data-shown={shown}>
      {children}
    </div>
  );
}

/**
 * The same observer, but the children stagger themselves off a CSS nth-child ladder rather than
 * each mounting its own IntersectionObserver. One observer per group instead of one per card is
 * the difference between a 36-card gallery costing 1 observer and costing 36.
 *
 * `stagger` is written as a custom property, so the step is a value the group owns and the
 * .reveal-group rules in globals.css read — nothing here computes a per-child delay.
 */
export function RevealGroup({
  children,
  stagger = 60,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  stagger?: number;
  className?: string;
  as?: "div" | "ul" | "ol" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.02 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <As
      ref={ref as never}
      className={cx("reveal-group", className)}
      data-shown={shown}
      style={{ "--stagger": `${stagger}ms` } as React.CSSProperties}
    >
      {children}
    </As>
  );
}

export function CountUp({ value, duration = 700, className, suffix }: { value: number; duration?: number; className?: string; suffix?: string }) {
  const { n } = useI18n();
  const [display, setDisplay] = useState(0);
  const previous = useRef(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const from = previous.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else previous.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className={cx("tnum", className)}>
      {n(display)}
      {suffix}
    </span>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** True pill geometry. The marketing layer only — console controls keep the 10px chamfer. */
  pill?: boolean;
  loading?: boolean;
};

/**
 * The primary action is INK. On an editorial white page a saturated blue button is the single
 * fastest way to look like a template, and brass has a job already: it rings focus, it marks
 * active, it colours links. So `primary` is a near-black fill and blue never fills anything.
 *
 * `size="lg"` and `pill` exist for the marketing layer; the console never passes either, which is
 * why `--radius-control` stays a 10px chamfer rather than being globally rounded to a capsule.
 */
export function Button({ variant = "secondary", size = "md", pill, loading, className, children, disabled, ...rest }: ButtonProps) {
  const base = cx(
    "inline-flex select-none items-center justify-center gap-2 font-medium",
    pill ? "rounded-[var(--radius-pill)]" : "rounded-[var(--radius-control)]",
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out",
    "disabled:pointer-events-none disabled:opacity-45",
  );
  const sizes = {
    sm: "px-3 py-1.5 text-[0.8125rem]",
    md: "px-4 py-2.5 text-[0.9375rem]",
    lg: "px-6 py-3.5 text-[0.9375rem] tracking-[-0.005em]",
  }[size];
  const variants = {
    // text-paper, not text-white: inside `.on-ink` the fill is light and the label has to invert
    // with it. On white that resolves to white-on-#151515 at 18.3:1.
    primary: "bg-ink text-paper hover:bg-ink-2 active:translate-y-px",
    secondary: "border border-line bg-paper text-ink hover:border-line-strong hover:bg-paper-2 active:translate-y-px active:bg-paper-3",
    ghost: "text-ink-2 hover:bg-overlay-2 hover:text-ink active:translate-y-px active:bg-overlay-3",
    // Deepen, never lighten: on white a lightened fill reads as disabled, not as pressed.
    danger: "bg-oxide text-paper hover:bg-oxide/90 active:translate-y-px",
  }[variant];
  return (
    <button className={cx(base, sizes, variants, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-3.5 w-3.5 shrink-0 animate-spin", className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  // A card rests on the ground. Hairline only, no shadow — it is not floating.
  return <As className={cx("rounded-[var(--radius-card)] border border-line bg-paper", className)}>{children}</As>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("eyebrow", className)}>{children}</p>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
      <div className="max-w-2xl">
        <h1 className="text-[2rem] leading-[1.15] tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type Tone = "neutral" | "brass" | "steel" | "good" | "warn" | "bad";

/**
 * Every -soft is an alpha wash of its own parent hue and every -line its 45% rim, so a chip tints
 * whatever surface it lands on instead of punching a pastel hole through a near-black panel.
 */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-overlay-2 text-ink-2",
  brass: "border-brass-line bg-brass-soft text-brass-deep",
  steel: "border-steel-line bg-steel-soft text-steel",
  good: "border-verdigris-line bg-verdigris-soft text-verdigris",
  warn: "border-saffron-line bg-saffron-soft text-saffron",
  bad: "border-oxide-line bg-oxide-soft text-oxide",
};

export function Chip({ tone = "neutral", icon, children, className, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[0.75rem] font-medium leading-5",
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * The mark. A vajra rendered as a bolt: one closed path, `currentColor`, no gradient, no second
 * shape. It appears in the site header, the console header, the auth screen and the footer, and
 * it was hand-copied into four files before this existed — so it lives here now and nowhere else.
 *
 * Decorative by default: every place it appears, the wordmark beside it already carries the name,
 * and a second announcement of "VAJRA" is noise for a screen reader. Pass a `label` for the one
 * case where it stands alone.
 */
export function VajraMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      className={cx("h-6 w-6", className)}
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z" fill="currentColor" />
    </svg>
  );
}

export const Icon = {
  check: <span aria-hidden>✓</span>,
  cross: <span aria-hidden>✗</span>,
  warn: <span aria-hidden>⚠</span>,
  dot: <span aria-hidden>●</span>,
  arrow: <span aria-hidden>→</span>,
  lock: <span aria-hidden>▮</span>,
  shield: <span aria-hidden>◆</span>,
};

// ─── Cryptographic material ──────────────────────────────────────────────────

export function HashValue({ value, label, chars = 8, className, full }: { value: string | null | undefined; label?: string; chars?: number; className?: string; full?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-ink-3">—</span>;
  const short = full || value.length <= chars * 2 + 1 ? value : `${value.slice(0, chars)}…${value.slice(-chars)}`;
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={cx(
        "group -mx-1 inline-flex items-center gap-1.5 rounded-[var(--radius-tag)] px-1 font-mono text-[0.8125rem] tnum text-ink-2",
        TRANSITION,
        "hover:bg-overlay-2 hover:text-ink active:translate-y-px",
        className,
      )}
    >
      {label && <span className="text-ink-3">{label}</span>}
      <span className="break-all">{short}</span>
      <span className={cx("text-[0.6875rem] transition-opacity duration-150 ease-out", copied ? "text-verdigris opacity-100" : "opacity-0 group-hover:opacity-60")}>
        {copied ? t("common.copied") : t("common.copy")}
      </span>
    </button>
  );
}

export function ConsolePanel({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  // The well sits only ~6% below the ground, so it earns its own ink hairline rather than relying
  // on fill alone — otherwise it flattens on anything that is not an OLED. The panel owns the
  // border; its header takes a bottom rule only.
  return (
    <div className={cx("overflow-hidden rounded-[var(--radius-panel)] border border-line bg-console text-console-text", className)}>
      {title && <div className="border-b border-line-faint px-4 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-console-muted">{title}</div>}
      <div className="console-scroll overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed">{children}</div>
    </div>
  );
}

// ─── Data display ────────────────────────────────────────────────────────────

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p
        className={cx(
          "mt-1.5 font-display text-[1.5rem] font-semibold leading-none tracking-[-0.015em] tnum",
          tone === "bad" && "text-oxide",
          tone === "good" && "text-verdigris",
          tone === "warn" && "text-saffron",
          tone === "steel" && "text-steel",
          tone === "brass" && "text-brass",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[0.75rem] leading-normal text-ink-3">{hint}</p>}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[0.75rem] leading-normal text-ink-3">{hint}</span>}
    </label>
  );
}

/**
 * A dark field is a shallow well, not a white box: an overlay wash inside a hairline, going brass
 * on focus. There is deliberately no focus:outline-none / focus:ring pair here — the global
 * :focus-visible rule already lays down the 2px brass outline plus the shadow-arc rim, it is
 * unlayered, and it outranks any utility that tried to cancel it. Disabled is opacity, not a
 * colour swap.
 */
export const inputClass = cx(
  "w-full rounded-[var(--radius-control)] border border-line bg-overlay-1 px-3 py-2 text-[0.9375rem] text-ink placeholder:text-ink-3",
  TRANSITION,
  "hover:border-line-strong focus:border-brass focus:bg-overlay-2",
  "disabled:pointer-events-none disabled:opacity-45",
);

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-overlay-1 px-6 py-12 text-center">
      <p className="font-display text-[1.25rem] font-semibold tracking-[-0.015em] text-ink">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-[0.875rem] leading-relaxed text-ink-2">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-[var(--radius-panel)]", className)} />;
}

export function ErrorNote({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-4 py-3">
      <p className="flex items-center gap-2 text-[0.875rem] text-oxide">
        {Icon.warn} {message}
      </p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-[var(--radius-panel)] border border-line", className)}>
      <table className="w-full min-w-[640px] border-collapse text-[0.875rem]">
        <thead>
          {/* The wrapper owns the border; the head takes a bottom rule only. */}
          <tr className="border-b border-line bg-paper-2">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * The hover lift is a background-IMAGE wash, not a background-COLOR swap, so it COMPOSITES OVER
 * whatever tone the caller painted on the row. `hover:bg-paper-2` would have replaced a DENY
 * row's red tint with a plain neutral — the row stopped looking denied at the exact moment the
 * operator pointed at it. This deepens the tone instead of erasing it, and it works the same for
 * a warn row and for a brass-soft selected row.
 *
 * The wash itself lives in globals.css as `.row-hover`, because its colour has to invert inside
 * `.on-ink`: a black wash is what deepens a row on white, and a white wash is what deepens one on
 * near-black. A literal rgba() in this class string could only ever be right on one of them.
 */
const ROW_HOVER = "row-hover";

export function Row({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      // tabIndex only — a role="button" on a <tr> would strip the row out of the table's grid
      // semantics, which is a worse trade than an unlabelled but reachable row.
      tabIndex={onClick ? 0 : undefined}
      className={cx(
        "border-b border-line/60 transition-[background-color,background-image] duration-150 ease-out last:border-0",
        onClick && cx("cursor-pointer", ROW_HOVER),
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, className, mono }: { children: ReactNode; className?: string; mono?: boolean }) {
  return <td className={cx("px-4 py-3 align-middle text-ink-2", mono && "font-mono text-[0.8125rem] tnum", className)}>{children}</td>;
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cx(
              "relative -mb-px rounded-t-[var(--radius-control)] px-4 py-2.5 text-[0.875rem] font-medium",
              "transition-[color,background-color] duration-150 ease-out",
              selected ? "text-ink" : "text-ink-3 hover:bg-overlay-1 hover:text-ink-2",
            )}
          >
            {tab.label}
            {/* brass is agency: it marks where you are. It is never a state. */}
            {selected && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-[var(--radius-pill)] bg-brass" />}
          </button>
        );
      })}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim p-4 pt-[6vh] backdrop-blur-[3px]" onClick={onClose}>
      {/* The one floating surface in this file: paper-raised so it OCCLUDES the page rather than
          tinting it, and shadow-float — which already carries its own 1px ink ring, so the panel
          takes no border of its own. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx("stamp w-full rounded-[var(--radius-card)] bg-paper-raised shadow-float", wide ? "max-w-3xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className={cx("-mr-1 rounded-[var(--radius-control)] px-2 py-1 text-ink-3", TRANSITION, "hover:bg-overlay-2 hover:text-ink active:translate-y-px")}
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Meter({ value, max = 100, tone = "steel", label, showValue = true }: { value: number; max?: number; tone?: Tone; label?: string; showValue?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const barColor = { neutral: "bg-ink-3", brass: "bg-brass", steel: "bg-steel", good: "bg-verdigris", warn: "bg-saffron", bad: "bg-oxide" }[tone];
  return (
    <div>
      {(label || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-3">
          {label && <span className="eyebrow">{label}</span>}
          {showValue && <span className="tnum font-mono text-[0.8125rem] text-ink-2">{value}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-paper-3"
      >
        <div className={cx("h-full rounded-[var(--radius-pill)] transition-[width] duration-700 ease-out-soft", barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function toneForTrust(score: number): Tone {
  if (score >= 75) return "good";
  if (score >= 45) return "warn";
  return "bad";
}
export function toneForRisk(tier: string): Tone {
  return tier === "high" ? "bad" : tier === "elevated" ? "warn" : "good";
}
export function toneForVerdict(verdict: string): Tone {
  return verdict === "ALLOW" ? "good" : verdict === "DENY" ? "bad" : verdict === "PENDING_APPROVAL" ? "steel" : "warn";
}
export function iconForVerdict(verdict: string): ReactNode {
  return verdict === "ALLOW" ? Icon.check : verdict === "DENY" ? Icon.cross : Icon.warn;
}
