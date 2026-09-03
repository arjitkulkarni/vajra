"use client";

/**
 * Console primitives — the operational half of the design system.
 *
 * `ui.tsx` is the editorial voice used by the public site: generous spacing, card radii, display
 * face. This file is the cockpit voice used inside /admin and /app: hairline borders, the tighter
 * tag/panel radius register, dense rows, tabular numerals, monospace for anything a machine
 * produced, and colour reserved for state.
 *
 * Surfaces follow the Blacklight elevation model: paper (rest) → paper-2 (header/thead/hover) →
 * paper-3 (pressed) → paper-raised + shadow-float (floating). Depth is light, never dark.
 *
 * Nothing here fetches. Pages pass labels in, so these stay locale-free.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, type Tone } from "./ui";

// ─── Surfaces ────────────────────────────────────────────────────────────────

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClass,
  flush,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  /** No body padding — for tables and streams that manage their own gutters. */
  flush?: boolean;
}) {
  return (
    <section className={cx("overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper", className)}>
      {(title || actions) && (
        <header className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-paper-2/70 px-3 py-1.5">
          {title && <span className="eyebrow">{title}</span>}
          {meta && <span className="tnum font-mono text-[0.6875rem] text-ink-3">{meta}</span>}
          {actions && <span className="ml-auto flex items-center gap-1.5">{actions}</span>}
        </header>
      )}
      <div className={cx(flush ? "" : "px-3 py-2.5", bodyClass)}>{children}</div>
    </section>
  );
}

/** A row of large figures separated by hairlines — the security-state band, not a grid of cards. */
export function StatBand({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string; onClick?: () => void }[];
  className?: string;
}) {
  return (
    <div
      className={cx(
        "grid divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0",
        className,
      )}
    >
      {items.map((item) => {
        const inner = (
          <>
            <p className="eyebrow">{item.label}</p>
            <p className={cx("mt-1 font-display text-[1.75rem] leading-none tracking-[-0.02em] tnum", TEXT_TONE[item.tone ?? "neutral"])}>{item.value}</p>
            {item.hint && <p className="mt-1.5 text-[0.75rem] leading-tight text-ink-3">{item.hint}</p>}
          </>
        );
        const cls = "block px-4 py-3 text-left";
        if (item.onClick)
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className={cx(cls, "transition-[background-color,box-shadow] duration-150 ease-out hover:bg-paper-2 active:translate-y-px active:bg-paper-3")}
            >
              {inner}
            </button>
          );
        return (
          <div key={item.label} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

const TEXT_TONE: Record<Tone, string> = {
  neutral: "text-ink",
  brass: "text-brass-deep",
  steel: "text-steel",
  good: "text-verdigris",
  warn: "text-saffron",
  bad: "text-oxide",
};

const DOT_TONE: Record<Tone, string> = {
  neutral: "text-ink-3",
  brass: "text-brass",
  steel: "text-steel",
  good: "text-verdigris",
  warn: "text-saffron",
  bad: "text-oxide",
};

/**
 * The smallest state carrier in the product. A glyph at 10px loses its silhouette on near-black, so
 * this is a true disc with a halo of its own hue: the halo doubles the apparent mass and keeps
 * verdigris / saffron / oxide discriminable at a glance down a forty-row table.
 */
export function StateDot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 18%, transparent)" }}
      className={cx("inline-block h-[7px] w-[7px] shrink-0 rounded-[var(--radius-pill)] bg-current align-[0.06em]", DOT_TONE[tone], pulse && "pulse", className)}
    />
  );
}

/** A machine-generated identifier. Chamfered, monospace, selectable — never decorated. */
export function IdTag({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-[var(--radius-tag)] border px-1.5 py-[3px] font-mono text-[0.6875rem] leading-none tracking-tight",
        ID_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const ID_TONE: Record<Tone, string> = {
  neutral: "border-line bg-paper-2 text-ink-2",
  brass: "border-brass-line bg-brass-soft text-brass-deep",
  steel: "border-steel-line bg-steel-soft text-steel",
  good: "border-verdigris-line bg-verdigris-soft text-verdigris",
  warn: "border-saffron-line bg-saffron-soft text-saffron",
  bad: "border-oxide-line bg-oxide-soft text-oxide",
};

/**
 * The verdict stamp: a word and a glyph, sized for a projector. The single most important visual in
 * the product, so it carries three reinforcing cues — a 2px rim of its hue, a wash of the same hue,
 * and the glyph — and lands with the 200ms strike at md/lg. `sm` is the in-table variant and stays
 * still: forty stamps striking at once on a table paint is a flash, not a signal.
 */
export function VerdictStamp({ verdict, label, size = "md" }: { verdict: string; label: string; size?: "sm" | "md" | "lg" }) {
  const tone: Tone = verdict === "ALLOW" ? "good" : verdict === "DENY" ? "bad" : verdict === "PENDING_APPROVAL" ? "steel" : "warn";
  const glyph = verdict === "ALLOW" ? "✓" : verdict === "DENY" ? "✗" : verdict === "PENDING_APPROVAL" ? "⧗" : "⚠";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-tag)] border-2 font-display font-semibold uppercase tracking-[0.06em]",
        size === "lg" ? "px-4 py-1.5 text-[1.25rem]" : size === "sm" ? "px-2 py-0.5 text-[0.75rem]" : "px-2.5 py-1 text-[0.9375rem]",
        size !== "sm" && "stamp",
        BORDER_TONE[tone],
        SOFT_TONE[tone],
        TEXT_TONE[tone],
      )}
    >
      <span aria-hidden className={cx("leading-none", size === "lg" && "text-[1.125rem]")}>
        {glyph}
      </span>
      {label}
    </span>
  );
}

const BORDER_TONE: Record<Tone, string> = {
  neutral: "border-line-strong",
  brass: "border-brass",
  steel: "border-steel",
  good: "border-verdigris",
  warn: "border-saffron",
  bad: "border-oxide",
};

/** The stamp's ground: a half-strength wash of its own hue, so the rim is not the only carrier. */
const SOFT_TONE: Record<Tone, string> = {
  neutral: "bg-paper-2",
  brass: "bg-brass-soft/50",
  steel: "bg-steel-soft/50",
  good: "bg-verdigris-soft/50",
  warn: "bg-saffron-soft/50",
  bad: "bg-oxide-soft/50",
};

// ─── Dense tables ────────────────────────────────────────────────────────────

export function DataTable({ cols, children, className, minWidth = 720 }: { cols: (ReactNode | { label: ReactNode; align?: "right"; width?: string })[]; children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cx("console-scroll overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[0.8125rem]" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line bg-paper-2/70">
            {cols.map((c, i) => {
              const col = c && typeof c === "object" && "label" in (c as object) ? (c as { label: ReactNode; align?: "right"; width?: string }) : { label: c as ReactNode };
              return (
                <th
                  key={i}
                  style={col.width ? { width: col.width } : undefined}
                  className={cx("whitespace-nowrap px-3 py-2 text-left text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink-3", col.align === "right" && "text-right")}
                >
                  {col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Hover COMPOSITES over the tone tint instead of replacing it. A neutral lift is brighter than the
 * red it would cover, so `hover:bg-paper-2` on a DENY row made the row stop looking denied at the
 * exact moment the operator pointed at it. Every tinted state gets its own deepened hover rung, and
 * clickable rows are reachable from the keyboard (the guard keeps a nested button's Enter from
 * firing the row as well).
 */
export function DataRow({ children, onClick, selected, tone, className }: { children: ReactNode; onClick?: () => void; selected?: boolean; tone?: "bad" | "warn"; className?: string }) {
  const base = tone === "bad" ? "bg-oxide-soft/55" : tone === "warn" ? "bg-saffron-soft/50" : selected ? "bg-brass-soft/65" : undefined;
  const hover = !onClick
    ? undefined
    : tone === "bad"
      ? "hover:bg-oxide-soft/95"
      : tone === "warn"
        ? "hover:bg-saffron-soft/85"
        : selected
          ? "hover:bg-brass-soft/95"
          : "hover:bg-paper-2";
  return (
    <tr
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cx(
        "border-b border-line-faint transition-colors duration-150 ease-out last:border-0",
        base,
        onClick && "cursor-pointer",
        hover,
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function DataCell({ children, mono, align, strong, muted, nowrap, className }: { children: ReactNode; mono?: boolean; align?: "right"; strong?: boolean; muted?: boolean; nowrap?: boolean; className?: string }) {
  return (
    <td
      className={cx(
        "px-3 py-1.5 align-middle leading-[1.45]",
        mono && "tnum font-mono text-[0.75rem]",
        align === "right" && "text-right",
        strong ? "font-medium text-ink" : muted ? "text-ink-3" : "text-ink-2",
        nowrap && "whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ─── Key/value blocks ────────────────────────────────────────────────────────

export function KeyValues({ items, columns = 1, className }: { items: { k: ReactNode; v: ReactNode; mono?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cx("grid gap-x-6", columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "", className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-line-faint py-1.5 last:border-0">
          <dt className="shrink-0 text-[0.75rem] uppercase tracking-[0.06em] text-ink-3">{item.k}</dt>
          <dd className={cx("min-w-0 truncate text-right text-[0.8125rem] text-ink", item.mono && "tnum font-mono text-[0.75rem]")}>{item.v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Event stream ────────────────────────────────────────────────────────────

export interface StreamEvent {
  id: string;
  at: string;
  /** Short uppercase headline: ACCESS DENIED, POLICY ACTIVATED, TRANSFER APPROVED. */
  headline: string;
  tone?: Tone;
  subject?: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}

export function EventStream({
  events,
  time,
  onSelect,
  empty,
  max,
}: {
  events: StreamEvent[];
  /** Formatter for the leading timestamp — pass the locale-aware one. */
  time: (iso: string) => string;
  onSelect?: (e: StreamEvent) => void;
  empty?: ReactNode;
  max?: number;
}) {
  const rows = max ? events.slice(0, max) : events;
  if (rows.length === 0) return <p className="px-3 py-6 text-center text-[0.8125rem] text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-line-faint">
      {rows.map((e, i) => (
        <li key={e.id}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(e)}
            style={{ animationDelay: `${Math.min(i * 35, 500)}ms` }}
            className={cx(
              "tick flex w-full items-start gap-3 px-3 py-2 text-left transition-colors duration-150 ease-out",
              onSelect && "hover:bg-paper-2 active:bg-paper-3",
            )}
          >
            <span className="tnum w-[62px] shrink-0 pt-px font-mono text-[0.75rem] text-ink-3">{time(e.at)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StateDot tone={e.tone ?? "neutral"} />
                <span className={cx("text-[0.75rem] font-semibold uppercase tracking-[0.07em]", TEXT_TONE[e.tone ?? "neutral"])}>{e.headline}</span>
                {e.subject}
              </span>
              {e.detail && <span className="mt-0.5 block truncate text-[0.75rem] text-ink-3">{e.detail}</span>}
            </span>
            {e.trailing && <span className="shrink-0 pt-px">{e.trailing}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Right-hand drawer ───────────────────────────────────────────────────────

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  closeLabel,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} />
      {/* Floating surface: paper-raised occludes, shadow-float separates, and it springs in on the
          new curve rather than the old sluggish one baked into the animate-[…] string. */}
      <aside
        style={{ width: `min(${width}px, 100vw)` }}
        className="relative flex h-full flex-col overflow-hidden rounded-l-[var(--radius-card)] bg-paper-raised shadow-float motion-safe:animate-[vajra-slide-in_220ms_var(--ease-out-soft)_both]"
      >
        <header className="flex items-start gap-3 border-b border-line bg-paper-2/70 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[1.0625rem] leading-tight tracking-[-0.015em]">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[0.75rem] text-ink-3">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-[var(--radius-control)] p-1.5 leading-none text-ink-3 transition-colors duration-150 ease-out hover:bg-paper-3 hover:text-ink active:translate-y-px"
          >
            ✕
          </button>
        </header>
        <div className="console-scroll min-h-0 flex-1 overflow-y-auto bg-paper px-4 py-4">{children}</div>
        {footer && <footer className="border-t border-line bg-paper-2/70 px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

// ─── "Why?" — the universal explanation surface ──────────────────────────────

export interface Factor {
  key: string;
  label: string;
  points?: number;
  max?: number;
  /** Bullet lines under the factor: what passed, what did not. */
  notes?: { ok: boolean | "warn"; text: string }[];
}

export function WhyButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line-strong bg-paper px-2 py-0.5 text-[0.75rem] font-medium text-ink-2",
        "transition-[color,background-color,border-color] duration-150 ease-out hover:border-brass-line hover:bg-brass-soft/40 hover:text-brass-deep active:translate-y-px",
        className,
      )}
    >
      {label}
    </button>
  );
}

/** The forensic breakdown behind a score: total, then each factor with its evidence. */
export function FactorBreakdown({ factors, n }: { factors: Factor[]; n: (v: number) => string }) {
  return (
    <ul className="space-y-3">
      {factors.map((f) => {
        const complete = f.points !== undefined && f.max !== undefined && f.points >= f.max;
        const zero = f.points === 0;
        const ratio = f.points !== undefined && f.max ? Math.max(0, Math.min(1, f.points / f.max)) : 0;
        return (
          <li key={f.key} className="border-b border-line-faint pb-3 last:border-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink">{f.label}</span>
              {f.points !== undefined && f.max !== undefined && (
                <span className={cx("tnum shrink-0 font-mono text-[0.75rem]", complete ? "text-verdigris" : zero ? "text-oxide" : "text-saffron")}>
                  {n(f.points)}/{n(f.max)}
                </span>
              )}
            </div>
            {f.points !== undefined && f.max !== undefined && f.max > 0 && (
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-[var(--radius-pill)] bg-paper-3">
                {/* scaleX, not width — the meter must not animate layout. */}
                <div
                  className={cx(
                    "h-full w-full origin-left rounded-[var(--radius-pill)] transition-transform duration-500 ease-out-soft",
                    complete ? "bg-verdigris" : zero ? "bg-oxide" : "bg-saffron",
                  )}
                  style={{ transform: `scaleX(${ratio})` }}
                />
              </div>
            )}
            {f.notes && f.notes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {f.notes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2 text-[0.8125rem] leading-snug">
                    <span aria-hidden className={cx("mt-px shrink-0 font-mono text-[0.75rem]", note.ok === true ? "text-verdigris" : note.ok === "warn" ? "text-saffron" : "text-oxide")}>
                      {note.ok === true ? "✓" : note.ok === "warn" ? "⚠" : "✗"}
                    </span>
                    <span className={note.ok === true ? "text-ink-2" : "text-ink"}>{note.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Big score with its label — used at the head of a Why drawer. */
export function ScoreHead({ score, outOf = 100, label, tone }: { score: string; outOf?: number; label: string; tone: Tone }) {
  return (
    <div className="mb-4 border-b border-line pb-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className={cx("font-display text-[2.5rem] font-semibold leading-none tracking-[-0.025em] tnum", TEXT_TONE[tone])}>{score}</span>
        <span className="tnum font-mono text-[0.875rem] text-ink-3">/ {outOf}</span>
      </p>
    </div>
  );
}

// ─── Effective access matrix: NOW vs NORMAL ──────────────────────────────────

export function AccessMatrix({
  rows,
  headings,
}: {
  rows: { action: string; label: string; now: "allow" | "step_up" | "deny"; normal: "allow" | "step_up" | "deny" }[];
  headings: { action: string; now: string; normal: string; allow: string; step_up: string; deny: string };
}) {
  const cell = (state: "allow" | "step_up" | "deny", dimmed?: boolean) => (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-[0.75rem] font-medium uppercase tracking-[0.06em]",
        dimmed ? "text-ink-3" : state === "allow" ? "text-verdigris" : state === "step_up" ? "text-saffron" : "text-oxide",
      )}
    >
      <span aria-hidden className="font-mono leading-none">
        {state === "allow" ? "✓" : state === "step_up" ? "⚠" : "✗"}
      </span>
      {headings[state]}
    </span>
  );
  return (
    <DataTable minWidth={320} cols={[headings.action, headings.now, { label: headings.normal, align: "right" }]}>
      {rows.map((r) => {
        const changed = r.now !== r.normal;
        return (
          <DataRow key={r.action} tone={changed ? (r.now === "deny" ? "bad" : "warn") : undefined}>
            <DataCell strong>{r.label}</DataCell>
            <DataCell>{cell(r.now)}</DataCell>
            <DataCell align="right">{cell(r.normal, true)}</DataCell>
          </DataRow>
        );
      })}
    </DataTable>
  );
}

// ─── Timelines ───────────────────────────────────────────────────────────────

export interface TimelineStep {
  id: string;
  at: string;
  label: string;
  tone?: Tone;
  detail?: ReactNode;
  metric?: { label: string; value: string; direction?: "up" | "down" };
}

/** Vertical rail with a cursor — the incident investigation view and its replay share this. */
export function StepRail({
  steps,
  cursor,
  onCursor,
  time,
  revealUpTo,
}: {
  steps: TimelineStep[];
  cursor?: number | null;
  onCursor?: (index: number) => void;
  time: (iso: string) => string;
  /** During replay, steps past this index are held back. */
  revealUpTo?: number;
}) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const hidden = revealUpTo !== undefined && i > revealUpTo;
        const active = cursor === i;
        return (
          <li key={s.id} className={cx("relative flex gap-3 pl-1 transition-opacity duration-300 ease-out", hidden ? "opacity-25" : "opacity-100")}>
            <div className="relative flex w-[62px] shrink-0 justify-end pr-3 pt-2">
              <span className="tnum font-mono text-[0.75rem] text-ink-3">{time(s.at)}</span>
            </div>
            <div className="relative flex w-4 shrink-0 justify-center">
              <span className={cx("absolute top-0 h-full w-px", i === steps.length - 1 ? "h-3" : "", "bg-line")} />
              <span
                className={cx(
                  "relative mt-2.5 h-2.5 w-2.5 shrink-0 rounded-[var(--radius-pill)] border-2 border-paper transition-shadow duration-200 ease-out-soft",
                  active ? "ring-2 ring-brass ring-offset-2 ring-offset-paper" : "",
                  s.tone === "bad" ? "bg-oxide" : s.tone === "warn" ? "bg-saffron" : s.tone === "good" ? "bg-verdigris" : s.tone === "brass" ? "bg-brass" : "bg-ink-3",
                )}
              />
            </div>
            <button
              type="button"
              disabled={!onCursor}
              onClick={() => onCursor?.(i)}
              className={cx(
                "min-w-0 flex-1 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-colors duration-150 ease-out",
                onCursor && !active && "hover:bg-paper-2 active:bg-paper-3",
                active && "bg-paper-3",
              )}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cx("text-[0.75rem] font-semibold uppercase tracking-[0.07em]", TEXT_TONE[s.tone ?? "neutral"])}>{s.label}</span>
                {s.metric && (
                  <span className="tnum font-mono text-[0.75rem] text-ink-2">
                    {s.metric.label} {s.metric.value}
                    {s.metric.direction && (
                      <span aria-hidden className={s.metric.direction === "down" ? "text-oxide" : "text-saffron"}>
                        {s.metric.direction === "down" ? " ↓" : " ↑"}
                      </span>
                    )}
                  </span>
                )}
              </span>
              {s.detail && <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{s.detail}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Charts, kept to what a security operator actually reads ─────────────────

/** A single stacked bar: trust distribution, denial reasons, access outcomes. */
export function DistributionBar({ segments, height = 8 }: { segments: { key: string; value: number; tone: Tone; label: string }[]; height?: number }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-[var(--radius-tag)] bg-paper-3" style={{ height }}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            title={`${s.label}: ${s.value}`}
            className={BAR_TONE[s.tone]}
            style={{
              width: `${(s.value / total) * 100}%`,
              // A ground-coloured kerf, so two adjacent saturated segments never fuse into one band.
              boxShadow: i < segments.length - 1 ? "inset -1px 0 0 var(--color-paper)" : undefined,
            }}
          />
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {segments.map((s) => (
          <li key={s.key} className="flex items-baseline gap-2 text-[0.8125rem]">
            <StateDot tone={s.tone} />
            <span className="text-ink-2">{s.label}</span>
            <span className="tnum ml-auto font-mono text-[0.75rem] text-ink">{Math.round((s.value / total) * 100)}%</span>
            <span className="tnum w-8 text-right font-mono text-[0.75rem] text-ink-3">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BAR_TONE: Record<Tone, string> = {
  neutral: "bg-ink-3",
  brass: "bg-brass",
  steel: "bg-steel",
  good: "bg-verdigris",
  warn: "bg-saffron",
  bad: "bg-oxide",
};

/** Trust over time. Axis labels stay, decoration does not. */
export function TrustHistoryChart({
  points,
  height = 132,
  tone = "steel",
  markers,
  time,
}: {
  points: { at: string; score: number }[];
  height?: number;
  tone?: Tone;
  markers?: { at: string; tone: Tone; title: string }[];
  time: (iso: string) => string;
}) {
  const gid = useId();
  if (points.length < 2) return null;
  const W = 640;
  const padL = 26;
  const padR = 8;
  const padY = 10;
  const t0 = new Date(points[0]!.at).getTime();
  const t1 = new Date(points[points.length - 1]!.at).getTime();
  const span = Math.max(t1 - t0, 1);
  const x = (iso: string) => padL + ((new Date(iso).getTime() - t0) / span) * (W - padL - padR);
  const y = (score: number) => padY + (height - padY * 2) * (1 - score / 100);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.at).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points[points.length - 1]!.at).toFixed(1)} ${height - padY} L ${padL} ${height - padY} Z`;
  const stroke = tone === "bad" ? "var(--color-oxide)" : tone === "warn" ? "var(--color-saffron)" : tone === "good" ? "var(--color-verdigris)" : "var(--color-steel)";
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} role="img" preserveAspectRatio="none">
        <defs>
          {/* On near-black an area wash carries roughly double the alpha it needed on cream. */}
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Rules: the 0 and 100 bounds are hairlines, the 50 midline is fainter and dashed, and all
            of them are non-scaling so the x-stretch cannot fatten them. */}
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(g)}
              y2={y(g)}
              stroke={g === 50 ? "var(--color-line-faint)" : "var(--color-line)"}
              strokeWidth="1"
              strokeDasharray={g === 50 ? "2 6" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            <text x={0} y={y(g) + 3} className="fill-[var(--color-ink-3)] font-mono text-[9px]">
              {g}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} className="draw" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {(markers ?? []).map((m, i) => (
          <g key={i}>
            <line
              x1={x(m.at)}
              x2={x(m.at)}
              y1={padY}
              y2={height - padY}
              stroke={m.tone === "bad" ? "var(--color-oxide)" : "var(--color-saffron)"}
              strokeWidth="1"
              strokeOpacity="0.7"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <title>{`${time(m.at)} · ${m.title}`}</title>
          </g>
        ))}
        {/* Vertices take a ground-coloured rim, so they read as beads ON the line rather than as
            thickenings OF it. */}
        {points.map((p, i) => (
          <circle key={i} cx={x(p.at)} cy={y(p.score)} r="2.5" fill={stroke} stroke="var(--color-paper)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            <title>{`${time(p.at)} · ${p.score}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// ─── Lineage rail ────────────────────────────────────────────────────────────

export interface LineageNode {
  id: string;
  label: string;
  sub?: string;
  kind: "ancestor" | "current" | "branch" | "descendant";
  tone?: Tone;
}

/**
 * The asset's line of descent as a rail, not a force-directed cloud: ancestors above, branches to
 * the right, the current version marked. Readable at a glance in a review meeting.
 */
export function LineageRail({ spine, branches, onSelect, selected }: { spine: LineageNode[]; branches: Record<string, LineageNode[]>; onSelect?: (node: LineageNode) => void; selected?: string }) {
  return (
    <ol className="space-y-0">
      {spine.map((node, i) => (
        <li key={node.id}>
          <div className="flex items-stretch gap-3">
            <div className="flex w-4 shrink-0 flex-col items-center">
              <span className={cx("w-px flex-1", i === 0 ? "bg-transparent" : "bg-line")} />
              <span
                className={cx(
                  "my-1 h-2.5 w-2.5 shrink-0 rotate-45 border",
                  node.kind === "current" ? "border-brass bg-brass" : "border-line-strong bg-paper",
                )}
              />
              <span className={cx("w-px flex-1", i === spine.length - 1 && (branches[node.id] ?? []).length === 0 ? "bg-transparent" : "bg-line")} />
            </div>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(node)}
              className={cx(
                "my-0.5 min-w-0 flex-1 rounded-[var(--radius-control)] border px-3 py-1.5 text-left transition-[color,background-color,border-color] duration-150 ease-out",
                selected === node.id ? "border-brass-line bg-brass-soft/60" : "border-transparent",
                onSelect && selected !== node.id && "hover:border-line hover:bg-paper-2 active:bg-paper-3",
              )}
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className={cx("font-mono text-[0.8125rem]", node.kind === "current" ? "font-medium text-ink" : "text-ink-2")}>{node.label}</span>
                {node.kind === "current" && <span className="eyebrow text-brass-deep">current</span>}
              </span>
              {node.sub && <span className="mt-0.5 block truncate text-[0.75rem] text-ink-3">{node.sub}</span>}
            </button>
          </div>
          {(branches[node.id] ?? []).map((b) => (
            <div key={b.id} className="flex items-center gap-3">
              <span className="flex w-4 shrink-0 justify-center">
                <span className="h-full w-px bg-line" />
              </span>
              <span aria-hidden className="-ml-1 font-mono text-[0.75rem] text-line-strong">
                └──►
              </span>
              <button
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(b)}
                className={cx(
                  "my-0.5 min-w-0 flex-1 rounded-[var(--radius-control)] border px-2.5 py-1 text-left transition-[color,background-color,border-color] duration-150 ease-out",
                  selected === b.id ? "border-brass-line bg-brass-soft/60" : "border-transparent",
                  onSelect && selected !== b.id && "hover:border-line hover:bg-paper-2 active:bg-paper-3",
                )}
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-[0.8125rem] text-ink-2">{b.label}</span>
                  {b.sub && <span className="shrink-0 font-mono text-[0.6875rem] text-ink-3">{b.sub}</span>}
                </span>
              </button>
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

// ─── Small parts ─────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.25rem] items-center justify-center rounded-[var(--radius-tag)] border border-line-strong bg-paper-2 px-1.5 py-px font-mono text-[0.6875rem] leading-[1.15rem] text-ink-3">
      {children}
    </kbd>
  );
}

/** The console's filter chrome: a shallow well the controls sit in, not a bare flex row. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-end gap-x-2 gap-y-2 rounded-[var(--radius-panel)] border border-line-faint bg-paper-2/40 p-2", className)}>{children}</div>
  );
}

/** One field recipe for both inputs: rest sits a step above the ground, focus takes the brass rim. */
const FIELD =
  "h-[32px] rounded-[var(--radius-control)] border border-line bg-paper-2/50 px-2 text-[0.8125rem] text-ink transition-[border-color,background-color,box-shadow] duration-150 ease-out hover:border-line-strong focus:border-brass focus:bg-paper focus:shadow-arc";

export function SelectInput({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label?: string; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      {label && <span className="eyebrow">{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, label, className, onEnter, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string; onEnter?: () => void; mono?: boolean }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      {label && <span className="eyebrow">{label}</span>}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        className={cx(FIELD, "w-full placeholder:text-ink-3", mono && "tnum font-mono text-[0.75rem]")}
      />
    </label>
  );
}

/** Toggle group used for status filters — reads as a segmented control, not a set of buttons. */
export function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; count?: number }[]; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="eyebrow">{label}</span>}
      <div className="inline-flex h-[32px] items-stretch overflow-hidden rounded-[var(--radius-control)] border border-line bg-paper-2/50 p-px">
        {options.map((o, i) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-[calc(var(--radius-control)_-_2px)] px-2.5 text-[0.8125rem] transition-[color,background-color,box-shadow] duration-150 ease-out",
                i > 0 && !on && "border-l border-line-faint",
                on ? "bg-brass-soft font-medium text-brass-deep shadow-lift" : "text-ink-2 hover:bg-paper-2 active:bg-paper-3",
              )}
            >
              {o.label}
              {o.count !== undefined && <span className={cx("tnum font-mono text-[0.6875rem]", on ? "text-brass-deep/80" : "text-ink-3")}>{o.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Console page header: dense, with live context on the right rather than marketing copy. */
export function OpsHeader({ title, id, status, actions, meta }: { title: ReactNode; id?: ReactNode; status?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          {id}
          {status}
        </div>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-ink-3">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** UTC wall clock — an operations console always says what time it thinks it is. */
export function LiveClock({ suffix = "UTC" }: { suffix?: string }) {
  const [now, setNow] = useState<string>("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const tick = () => mounted.current && setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);
  if (!now) return null;
  return (
    <span className="tnum inline-flex items-center gap-1.5 rounded-[var(--radius-tag)] border border-line-faint bg-paper-2/60 px-1.5 py-0.5 font-mono text-[0.75rem] leading-none text-ink-3">
      {now} {suffix}
    </span>
  );
}

export function useNowTick(intervalMs = 15_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/** Group a flat list by a key, preserving first-seen order. */
export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function useCounts<T>(items: T[] | null, key: (item: T) => string): Record<string, number> {
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const item of items ?? []) {
      const k = key(item);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
}
