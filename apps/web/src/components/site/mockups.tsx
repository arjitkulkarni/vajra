/**
 * THE PRODUCT-VISUAL ENGINE
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every product visual on the marketing site is built here, out of layered divs and inline SVG on
 * the real Daylight tokens. There are no images, no stock screenshots and no external assets — the
 * mockups look like a shipped product because they are cut from the same surfaces the shipped
 * product is made of. Read `console.tsx` and `trust.tsx` and you will recognise every register in
 * this file: the paper-2 panel header, the hairline table, the tag-radius verdict stamp, the
 * near-black policy strip under a decision, the five gates taking their turn.
 *
 * ── WHY THIS FILE IMPORTS NOTHING ───────────────────────────────────────────────────────────────
 * `ui.tsx`, `console.tsx` and `trust.tsx` are all `"use client"`. A server component that imported
 * a value from one of them would get an opaque client reference, not a function — so `cx` is
 * redeclared here, one line of it, and these compositions are otherwise dependency-free. That is
 * the whole reason this file duplicates anything, and it duplicates nothing else: no component is
 * re-implemented, only re-composed at mockup scale. Without `"use client"` this module renders on
 * the server inside an editorial band AND compiles into the client graph when the Explorer imports
 * it — one file, both worlds.
 *
 * ── DETERMINISM IS A CORRECTNESS REQUIREMENT, NOT A PREFERENCE ──────────────────────────────────
 * A gallery of 36 cards must not show 36 identical pictures, so `seed` varies the CONTENT — which
 * hash, which score, which row is lit. It is a pure integer hash over fixed literal tables. There
 * is no `Math.random()` and no `Date.now()` anywhere below: these render on the server first, and
 * a value that differs on the client is a hydration error, not a cosmetic one.
 *
 * ── FOUR SCALE LEVELS, ONE SET OF COMPONENTS ────────────────────────────────────────────────────
 * micro (a chip, a meter, a hash row) · medium (a component card) · large (a whole product screen)
 * · extra-large (an immersive figure spanning a section). A mockup cannot know the viewport — a
 * hero visual is widest exactly when a gallery card is narrowest — so it sizes itself off its own
 * CONTAINER. Each root is an `@container`; type and padding step up at `@lg` and `@3xl`. The base
 * sizes are tuned for a 4/3 gallery well, so if a container query never matches the mockup is
 * merely small, never broken.
 *
 * ── HOUSE RULES OBSERVED THROUGHOUT ─────────────────────────────────────────────────────────────
 * Tokens only, never a raw colour — which is also the entire reason every mockup survives being
 * dropped inside `.on-ink` with no second code path. Radii from the ramp: frames 28, media wells
 * 22, cards 18, instrument surfaces 6, tags 4, chips 999. `overflow-hidden` on every frame, so a
 * mockup can never push the page wide. No transitions and no animation, with one licensed
 * exception: `LivenessGate` may run the existing `.auth-gate-fill` once, and `Mockup` turns even
 * that off, because nothing in a gallery card should move on its own.
 *
 * Text inside a mockup is fake UI chrome, not content. It deliberately does NOT go through i18n —
 * a screenshot of a console is a picture of a console — and it is kept short enough never to wrap.
 * Anything a machine produced is mono. Purely decorative mockups are `aria-hidden`; the five that
 * carry an argument the surrounding copy does not make take `role="img"` and an overridable
 * `label`. Fourteen descriptions of decorative furniture read aloud is worse than silence.
 */

import type { ReactNode } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ─── Determinism ─────────────────────────────────────────────────────────────
//
// A 32-bit integer avalanche (the murmur3 finaliser). Pure, total, and identical on the server and
// in the browser because it never leaves the int32 domain — `Math.imul` is exact where `*` would
// have drifted into float territory and desynchronised a hydration.

function mix(seed: number, salt: number): number {
  let x = (seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

/** Deterministically choose one entry of a fixed table. */
function pick<T>(table: readonly T[], seed: number, salt: number): T {
  return table[mix(seed, salt) % table.length]!;
}

/** Deterministically choose an integer in [lo, hi]. */
function span(seed: number, salt: number, lo: number, hi: number): number {
  return lo + (mix(seed, salt) % (hi - lo + 1));
}

/** Rotate a fixed table, so a gallery never opens two cards on the same row. */
function rotate<T>(table: readonly T[], seed: number, salt: number): T[] {
  const offset = mix(seed, salt) % table.length;
  return [...table.slice(offset), ...table.slice(0, offset)];
}

// ─── The corpus ──────────────────────────────────────────────────────────────
//
// Every hash, id, DID and clock reading on the marketing site is a literal that lives here. They
// read as real material because they have the right shape and the right entropy; they are stable
// because they were typed into the file rather than generated at render time.

const HASHES = [
  "5d1e1e9381e3769467546ad2fd95d7d488baed41d894ccfe1c79e870423ec782",
  "f27f9a09f94bf88662a8dfeb976b5da66f5a8b57b7aec4713ec63c4c2c08c01a",
  "e04d177172837db2bf39d8de4117a15bbd9043272e90be5993fb6fa725638d07",
  "e6e22540bdc6762025318db4bebdc24b0453502966eb8066f38620f47f4d4709",
  "5b5161a350f07136ed4c5d8440a9340ef366997993b67a97fca337ef9f66144e",
  "997cae6ae9cdd577328ed050eb250f9d0ea9f6d4e39f55477c11a9642391b41b",
  "a638ba34ba677e5e686a62bd67f46081d39c86618ba1da249d76485903336f43",
  "98657afd54028b0e3303beb117e50fa281ca2ca00ec6816f7e12d4baa4e11fe4",
  "e0181a44766606c417b0353dec19f49396d5074116d07155a39257447f0fe07c",
  "7b72755ef9c1c06d9505aeae5d30fbc6bc699668bb13cae27cf8043fb33cb45c",
] as const;

const RECORD_IDS = ["PoA-8F31C2", "PoA-4B7E90", "PoA-C2A410", "PoA-19D3F5", "PoA-7E0B44", "PoA-A5C138", "PoA-3F9A4C", "PoA-D40E21"] as const;

const ASSET_UIDS = ["ast_2ea23c79", "ast_3c33457e", "ast_25df0b29", "ast_9fd92f90", "ast_69a1c204", "ast_8404d501", "ast_cc91fce5", "ast_2b7ae740"] as const;

const DIDS = [
  "did:vajra:z6Mk7252418494",
  "did:vajra:z6Mkb891d3f550",
  "did:vajra:z6Mk1baff457ee",
  "did:vajra:z6Mk408f10e3b2",
  "did:vajra:z6Mk297a67d56b",
] as const;

const TX_IDS = ["0x5e97f2ecd209446c", "0xf98f1c4e39144423", "0x0796345dd7a3a68c", "0xa621d295c9823ede", "0xdfc185e001782a95"] as const;

type AssetShape = "design" | "model" | "certificate" | "document";

const ASSETS: readonly { name: string; shape: AssetShape; sub: string }[] = [
  { name: "turbine-blade-v7.step", shape: "design", sub: "CAD · rev 7" },
  { name: "rotor-housing.iges", shape: "design", sub: "CAD · rev 3" },
  { name: "fatigue-model.onnx", shape: "model", sub: "ONNX · 41 MB" },
  { name: "thermal-map.onnx", shape: "model", sub: "ONNX · 12 MB" },
  { name: "iso-9001-cert.pdf", shape: "certificate", sub: "Certificate" },
  { name: "type-approval.pdf", shape: "certificate", sub: "Certificate" },
  { name: "supplier-nda.pdf", shape: "document", sub: "Contract" },
  { name: "audit-2026-q1.pdf", shape: "document", sub: "Report" },
] as const;

const ROLES = ["engineer", "manager", "auditor", "admin"] as const;
const DEVICES = ["MacBook Pro · Bengaluru", "ThinkPad X1 · Pune", "iPad Pro · Chennai", "Latitude 7420 · Hyderabad"] as const;
const CLOCKS = ["09:14:22", "10:41:05", "12:03:58", "14:32:07", "16:20:44", "18:07:11"] as const;

// ─── Tone ────────────────────────────────────────────────────────────────────
//
// The same six-tone vocabulary the console speaks, narrowed to what a mockup needs. Colour is
// never the only carrier here either: every tone below always ships beside a glyph and a word.

type MTone = "neutral" | "brass" | "steel" | "good" | "warn" | "bad";

const TEXT_TONE: Record<MTone, string> = {
  neutral: "text-ink-2",
  brass: "text-brass-deep",
  steel: "text-steel",
  good: "text-verdigris",
  warn: "text-saffron",
  bad: "text-oxide",
};

const CHIP_TONE: Record<MTone, string> = {
  neutral: "border-line bg-overlay-2 text-ink-2",
  brass: "border-brass-line bg-brass-soft text-brass-deep",
  steel: "border-steel-line bg-steel-soft text-steel",
  good: "border-verdigris-line bg-verdigris-soft text-verdigris",
  warn: "border-saffron-line bg-saffron-soft text-saffron",
  bad: "border-oxide-line bg-oxide-soft text-oxide",
};

const BAR_TONE: Record<MTone, string> = {
  neutral: "bg-ink-3",
  brass: "bg-brass",
  steel: "bg-steel",
  good: "bg-verdigris",
  warn: "bg-saffron",
  bad: "bg-oxide",
};

export type MockupVerdict = "ALLOW" | "STEP_UP" | "DENY";

const VERDICT_TONE: Record<MockupVerdict, MTone> = { ALLOW: "good", STEP_UP: "warn", DENY: "bad" };
const VERDICT_GLYPH: Record<MockupVerdict, string> = { ALLOW: "✓", STEP_UP: "⚠", DENY: "✗" };
const VERDICTS: readonly MockupVerdict[] = ["ALLOW", "STEP_UP", "DENY"];

/** Rows keep their tint at rest, exactly as `DataRow` does — a denied row must always look denied. */
const ROW_TINT: Record<MockupVerdict, string> = { ALLOW: "", STEP_UP: "bg-saffron-soft/50", DENY: "bg-oxide-soft/55" };

function trustTone(score: number): MTone {
  return score >= 75 ? "good" : score >= 45 ? "warn" : "bad";
}

// ─── Atoms ───────────────────────────────────────────────────────────────────

/** The mark, as one closed path. Inlined rather than imported, for the RSC reason at the top. */
function Bolt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cx("shrink-0", className)} fill="none" aria-hidden>
      <path d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z" fill="currentColor" />
    </svg>
  );
}

type RailShape = "overview" | "decisions" | "assets" | "policies" | "incidents";

/** Console rail glyphs. Drawn, not typed: a box-drawing character is a different shape in every font. */
function RailIcon({ shape, className }: { shape: RailShape; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cx("h-3 w-3 @lg:h-3.5 @lg:w-3.5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {shape === "overview" && (
        <>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </>
      )}
      {shape === "decisions" && <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />}
      {shape === "assets" && (
        <>
          <path d="M8 2 14 5.2v5.6L8 14 2 10.8V5.2Z" />
          <path d="M2 5.2 8 8.4l6-3.2M8 8.4V14" />
        </>
      )}
      {shape === "policies" && (
        <>
          <path d="M8 2l5 2v4.2c0 3-2.1 5-5 5.8-2.9-.8-5-2.8-5-5.8V4Z" />
          <path d="M6 8l1.6 1.6L10.4 6.6" />
        </>
      )}
      {shape === "incidents" && (
        <>
          <path d="M8 2.6 14.4 13H1.6Z" />
          <path d="M8 6.6v3.1M8 11.4v.2" />
        </>
      )}
    </svg>
  );
}

/** The verdict stamp at mockup scale: rim, wash and glyph, in the tag radius the console uses. */
function Stamp({ verdict, big, className }: { verdict: MockupVerdict; big?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-tag)] border font-semibold uppercase leading-none tracking-[0.06em]",
        big
          ? "border-2 px-1.5 py-1 text-[0.625rem] @lg:px-2.5 @lg:py-1.5 @lg:text-[0.8125rem]"
          : "px-1 py-[3px] text-[0.5rem] @lg:px-1.5 @lg:text-[0.625rem]",
        CHIP_TONE[VERDICT_TONE[verdict]],
        className,
      )}
    >
      <span aria-hidden>{VERDICT_GLYPH[verdict]}</span>
      {verdict === "STEP_UP" ? "STEP UP" : verdict}
    </span>
  );
}

/** The pill for anything that is not a verdict: anchored, pending, verified, sealed. */
function Tag({ tone = "neutral", glyph, children, className }: { tone?: MTone; glyph?: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-pill)] border px-1.5 py-px text-[0.5625rem] font-medium leading-[1.45] @lg:px-2 @lg:text-[0.6875rem]",
        CHIP_TONE[tone],
        className,
      )}
    >
      {glyph && (
        <span aria-hidden className="leading-none">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}

/** The result ring that heads every check row in `TraceRow` and `ProofChecks`. */
function Pip({ tone, glyph, className }: { tone: MTone; glyph: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[var(--radius-pill)] border text-[0.5rem] font-semibold leading-none @lg:h-[1.125rem] @lg:w-[1.125rem] @lg:text-[0.625rem]",
        CHIP_TONE[tone],
        className,
      )}
    >
      {glyph}
    </span>
  );
}

/** The state disc, with the halo that keeps it discriminable at 7px — `StateDot`, at mockup scale. */
function Dot({ tone, className }: { tone: MTone; className?: string }) {
  return <span aria-hidden className={cx("inline-block h-[5px] w-[5px] shrink-0 rounded-[var(--radius-pill)] bg-current align-[0.08em]", TEXT_TONE[tone], className)} />;
}

/**
 * A meter track. The width is a computed percentage, which is the one thing a utility class cannot
 * express — `Meter` in ui.tsx and `FactorBreakdown` in console.tsx both solve it exactly this way.
 */
function Bar({ value, tone, className }: { value: number; tone: MTone; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span className={cx("block h-1 w-full overflow-hidden rounded-[var(--radius-pill)] bg-paper-3", className)}>
      <span className={cx("block h-full rounded-[var(--radius-pill)]", BAR_TONE[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The label above every dense instrument block. `.eyebrow` is 11px — too loud at mockup scale. */
function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("block text-[0.5rem] font-semibold uppercase leading-[1.6] tracking-[0.12em] text-ink-3 @lg:text-[0.625rem]", className)}>{children}</span>
  );
}

/** Anything a machine produced. */
function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("tnum font-mono text-[0.5625rem] leading-[1.5] @lg:text-[0.6875rem]", className)}>{children}</span>;
}

/** A short hash, elided in the middle the way `HashValue` elides one. */
function shortHash(hash: string, chars = 6): string {
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

/**
 * Thousands separators, by hand. `toLocaleString` reads the ambient ICU data, which is one more
 * thing that can differ between the Node render and the browser render — and a number that changes
 * shape on hydration is a React error, not a typo.
 */
function grouped(value: number): string {
  const digits = String(value);
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ",";
  }
  return out;
}

/**
 * The asset thumbnail: a technical drawing, not a photograph. Four silhouettes, one per asset
 * class, in decorative hairlines over a well — enough to say "turbine blade" or "signed
 * certificate" at 40px without pretending to be a render.
 */
function AssetGlyph({ shape, className }: { shape: AssetShape; className?: string }) {
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper-3 text-ink-3", className)}>
      <svg viewBox="0 0 32 32" className="h-full w-full p-[15%]" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
        {shape === "design" && (
          <g>
            <path d="M11 27c-1.5-6 0-13 5-19 4 4 6.5 9 6 14-.4 3.6-2 5-5.5 5Z" />
            <path d="M16 8v19M11.6 20.5h9.2M12.6 14.6h6.6" className="text-ink-4" strokeDasharray="1.5 2" />
          </g>
        )}
        {shape === "model" && (
          <g>
            <circle cx="7" cy="9" r="2.4" />
            <circle cx="7" cy="23" r="2.4" />
            <circle cx="16" cy="16" r="2.4" />
            <circle cx="25" cy="10" r="2.4" />
            <circle cx="25" cy="22" r="2.4" />
            <path d="M9.2 10.2 13.7 14.5M9.2 21.8 13.7 17.5M18.3 14.8 22.8 11.4M18.3 17.2 22.8 20.6" className="text-ink-4" />
          </g>
        )}
        {shape === "certificate" && (
          <g>
            <rect x="5" y="4" width="21" height="18" rx="1.5" />
            <path d="M9 10h13M9 14h13M9 18h7" className="text-ink-4" />
            <circle cx="22" cy="24" r="4.5" />
            <path d="M19.9 24.2 21.4 25.7 24.2 22.8" />
          </g>
        )}
        {shape === "document" && (
          <g>
            <path d="M7 3h11l6 6v20H7Z" />
            <path d="M18 3v6h6" />
            <path d="M11 15h9M11 19h9M11 23h5" className="text-ink-4" />
          </g>
        )}
      </svg>
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// FRAMES — the housings a screen is shown in
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The browser. Chrome bar, three dots, a URL pill — and then it gets out of the way, because the
 * frame is not the visual, the screen inside it is. `--radius-frame` at 28, `overflow-hidden`, and
 * a body that is `flex-1 min-h-0` so an aspect-locked frame hands its full height to the screen
 * and a content-sized frame simply wraps it.
 */
export function BrowserFrame({ children, url = "vajra.app/decisions", className }: { children?: ReactNode; url?: string; className?: string }) {
  return (
    <div className={cx("@container flex w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-frame)] border border-line bg-paper shadow-media", className)}>
      <div aria-hidden className="flex shrink-0 items-center gap-2 border-b border-line bg-paper-2 px-3 py-2 @lg:gap-3 @lg:px-4 @lg:py-2.5">
        <span className="flex shrink-0 items-center gap-[5px]">
          <span className="block h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-ink-4 @lg:h-2 @lg:w-2" />
          <span className="block h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-ink-4 @lg:h-2 @lg:w-2" />
          <span className="block h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-ink-4 @lg:h-2 @lg:w-2" />
        </span>
        <span className="hidden shrink-0 items-center gap-2 text-ink-4 @md:flex">
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </span>
        {/* The URL pill is the only true pill in this frame — the address bar is the one control
            here that is genuinely a capsule in every browser ever shipped. */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-pill)] border border-line bg-paper px-2 py-[3px] @lg:px-3 @lg:py-1">
          <svg viewBox="0 0 16 16" className="h-[9px] w-[9px] shrink-0 text-verdigris @lg:h-2.5 @lg:w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3.5" y="7" width="9" height="6" rx="1.2" />
            <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" />
          </svg>
          <Mono className="min-w-0 truncate text-ink-3">{url}</Mono>
        </span>
        <span className="hidden shrink-0 gap-[3px] @md:flex">
          <span className="block h-[3px] w-[3px] rounded-[var(--radius-pill)] bg-ink-4" />
          <span className="block h-[3px] w-[3px] rounded-[var(--radius-pill)] bg-ink-4" />
          <span className="block h-[3px] w-[3px] rounded-[var(--radius-pill)] bg-ink-4" />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-paper">{children}</div>
    </div>
  );
}

/**
 * The phone. The bezel is `console` rather than `ink`, because the near-black is a MATERIAL: a
 * device housing stays a device housing inside `.on-ink`, where `ink` would have flipped white and
 * turned the handset inside out.
 */
export function PhoneFrame({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cx("@container relative w-full overflow-hidden rounded-[var(--radius-frame)] border border-line bg-console p-1.5 shadow-media", className)}>
      <span aria-hidden className="absolute left-1/2 top-[9px] z-10 h-[5px] w-11 -translate-x-1/2 rounded-[var(--radius-pill)] bg-console-3" />
      <div className="relative aspect-[9/18] w-full overflow-hidden rounded-[var(--radius-media)] bg-paper">{children}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LARGE — whole product screens
// ═════════════════════════════════════════════════════════════════════════════

const RAIL: readonly RailShape[] = ["overview", "decisions", "assets", "policies", "incidents"];

type ScreenRow = { id: string; asset: string; role: string; verdict: MockupVerdict; trust: number; at: string; device: string };

const SCREEN_ROWS: readonly ScreenRow[] = [
  { id: "PoA-8F31C2", asset: "turbine-blade-v7.step", role: "engineer", verdict: "ALLOW", trust: 94, at: "14:32:07", device: "MacBook Pro" },
  { id: "PoA-4B7E90", asset: "rotor-housing.iges", role: "manager", verdict: "ALLOW", trust: 91, at: "14:28:41", device: "ThinkPad X1" },
  { id: "PoA-C2A410", asset: "fatigue-model.onnx", role: "engineer", verdict: "STEP_UP", trust: 68, at: "14:21:19", device: "iPad Pro" },
  { id: "PoA-19D3F5", asset: "iso-9001-cert.pdf", role: "auditor", verdict: "ALLOW", trust: 88, at: "14:16:52", device: "Latitude 7420" },
  { id: "PoA-7E0B44", asset: "supplier-nda.pdf", role: "manager", verdict: "ALLOW", trust: 83, at: "14:09:03", device: "MacBook Pro" },
  { id: "PoA-A5C138", asset: "blade-tolerance.step", role: "engineer", verdict: "DENY", trust: 31, at: "13:58:36", device: "unknown host" },
  { id: "PoA-3F9A4C", asset: "thermal-map.onnx", role: "engineer", verdict: "ALLOW", trust: 90, at: "13:47:12", device: "ThinkPad X1" },
  { id: "PoA-D40E21", asset: "audit-2026-q1.pdf", role: "auditor", verdict: "ALLOW", trust: 86, at: "13:39:58", device: "Latitude 7420" },
  { id: "PoA-62B8AF", asset: "rotor-v8-draft.iges", role: "manager", verdict: "STEP_UP", trust: 72, at: "13:31:20", device: "iPad Pro" },
  { id: "PoA-0B54E7", asset: "type-approval.pdf", role: "admin", verdict: "ALLOW", trust: 96, at: "13:22:44", device: "MacBook Pro" },
];

/**
 * THE OPS SCREEN — the largest thing in this file, and the one a reviewer should mistake for a
 * screenshot. Nav rail, header, stat band, dense table, in exactly the proportions `/app` uses.
 *
 * It sets no height of its own: `h-full` fills an aspect-locked well, `min-h` keeps it honest when
 * a caller drops it into an unsized box, and the table region is `flex-1` so a tall frame simply
 * reveals more rows rather than stretching the ones it has. In a 4/3 gallery well the last rows
 * are clipped by the well — which is what a real screenshot thumbnail does too.
 */
export function ConsoleScreen({ className, seed = 0 }: { className?: string; seed?: number }) {
  const rows = rotate(SCREEN_ROWS, seed, 11).slice(0, 9);
  const active = mix(seed, 12) % RAIL.length;
  const decisions = span(seed, 13, 940, 3480);
  const allowPct = span(seed, 14, 68, 84);
  const p95 = span(seed, 15, 96, 178);

  const stats: { label: string; value: string; tone: MTone; hint: string }[] = [
    { label: "Decisions", value: grouped(decisions), tone: "neutral", hint: "last 24h" },
    { label: "Allowed", value: `${allowPct}%`, tone: "good", hint: `${100 - allowPct}% held` },
    { label: "Anchored", value: "100%", tone: "steel", hint: "0 pending" },
    { label: "p95", value: `${p95}ms`, tone: p95 > 150 ? "warn" : "good", hint: "decision time" },
  ];

  return (
    <div aria-hidden className={cx("@container console-root flex h-full min-h-[15rem] w-full min-w-0 overflow-hidden bg-paper text-ink", className)}>
      {/* ── nav rail ── */}
      <nav className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-line bg-paper-2 py-2 @lg:w-12 @lg:gap-1.5 @lg:py-3">
        <Bolt className="h-3.5 w-3.5 text-ink @lg:h-4 @lg:w-4" />
        <span className="my-1 block h-px w-4 bg-line @lg:w-6" />
        {RAIL.map((shape, i) => (
          <span
            key={shape}
            className={cx(
              "relative grid h-5 w-5 place-items-center rounded-[var(--radius-control)] @lg:h-7 @lg:w-7",
              i === active ? "bg-brass-soft text-brass-deep" : "text-ink-4",
            )}
          >
            {i === active && <span className="absolute -left-2 h-3 w-[2px] rounded-[var(--radius-pill)] bg-brass @lg:-left-[10px] @lg:h-4" />}
            <RailIcon shape={shape} />
          </span>
        ))}
        <span className="mt-auto grid h-5 w-5 place-items-center rounded-[var(--radius-pill)] border border-line bg-paper text-[0.4375rem] font-semibold leading-none text-ink-3 @lg:h-7 @lg:w-7 @lg:text-[0.5625rem]">
          AR
        </span>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── header ── */}
        <header className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-1.5 @lg:gap-2.5 @lg:px-4 @lg:py-2.5">
          <span className="truncate text-[0.6875rem] font-semibold leading-none tracking-[-0.015em] text-ink @lg:font-display @lg:text-[0.9375rem]">Decisions</span>
          <span className="hidden rounded-[var(--radius-tag)] border border-line bg-paper-2 px-1 py-px @sm:inline-block">
            <Mono className="text-ink-3">last 24h</Mono>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className="hidden items-center gap-1 @md:inline-flex">
              <Dot tone="good" />
              <Mono className="text-ink-3">live</Mono>
            </span>
            <span className="rounded-[var(--radius-tag)] border border-line-faint bg-paper-2 px-1 py-px @lg:px-1.5">
              <Mono className="text-ink-3">14:32:07 UTC</Mono>
            </span>
          </span>
        </header>

        {/* ── stat band ── */}
        <div className="grid shrink-0 grid-cols-4 divide-x divide-line border-b border-line">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 px-2 py-1.5 @lg:px-3 @lg:py-2.5">
              <Label className="truncate">{s.label}</Label>
              <p className={cx("tnum mt-px truncate text-[0.8125rem] font-semibold leading-none tracking-[-0.02em] @lg:font-display @lg:text-[1.25rem]", TEXT_TONE[s.tone])}>{s.value}</p>
              <span className="mt-[3px] hidden truncate text-[0.5rem] leading-tight text-ink-3 @lg:block @lg:text-[0.625rem]">{s.hint}</span>
            </div>
          ))}
        </div>

        {/* ── the table ── */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <table className="w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-paper-2">
                <th className="w-[20%] px-2 py-1 @lg:px-3 @lg:py-1.5">
                  <Label className="truncate">Request</Label>
                </th>
                <th className="px-2 py-1 @lg:px-3 @lg:py-1.5">
                  <Label className="truncate">Asset</Label>
                </th>
                <th className="hidden w-[13%] px-3 py-1.5 @xl:table-cell">
                  <Label className="truncate">Role</Label>
                </th>
                <th className="hidden w-[16%] px-3 py-1.5 @3xl:table-cell">
                  <Label className="truncate">Device</Label>
                </th>
                <th className="w-[18%] px-2 py-1 @lg:px-3 @lg:py-1.5">
                  <Label className="truncate">Verdict</Label>
                </th>
                <th className="w-[11%] px-2 py-1 text-right @lg:px-3 @lg:py-1.5">
                  <Label className="truncate">Trust</Label>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cx("border-b border-line-faint", ROW_TINT[r.verdict])}>
                  <td className="truncate px-2 py-1 @lg:px-3 @lg:py-1.5">
                    <Mono className="text-ink">{r.id}</Mono>
                  </td>
                  <td className="truncate px-2 py-1 @lg:px-3 @lg:py-1.5">
                    <span className="block truncate text-[0.5625rem] leading-[1.5] text-ink-2 @lg:text-[0.75rem]">{r.asset}</span>
                  </td>
                  <td className="hidden truncate px-3 py-1.5 @xl:table-cell">
                    <span className="block truncate text-[0.75rem] text-ink-3">{r.role}</span>
                  </td>
                  <td className="hidden truncate px-3 py-1.5 @3xl:table-cell">
                    <Mono className="text-ink-3">{r.device}</Mono>
                  </td>
                  <td className="px-2 py-1 @lg:px-3 @lg:py-1.5">
                    <Stamp verdict={r.verdict} />
                  </td>
                  <td className="px-2 py-1 text-right @lg:px-3 @lg:py-1.5">
                    <Mono className={TEXT_TONE[trustTone(r.trust)]}>{r.trust}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * The handset screen: one step-up, from the point of view of the person being asked. Deliberately
 * NOT a shrunken console — a phone gets one job, one face and one button.
 */
export function PhoneScreen({ className, seed = 0 }: { className?: string; seed?: number }) {
  const asset = pick(ASSETS, seed, 21);
  const id = pick(RECORD_IDS, seed, 22);
  const score = (span(seed, 23, 90, 98) / 100).toFixed(2);

  return (
    <div aria-hidden className={cx("@container flex h-full w-full flex-col bg-paper", className)}>
      {/* status bar */}
      <div className="flex shrink-0 items-center justify-between px-2.5 pb-0.5 pt-2">
        <Mono className="text-ink">09:41</Mono>
        <span className="flex items-center gap-[3px] text-ink">
          <span className="block h-[5px] w-[2px] rounded-[var(--radius-pill)] bg-current" />
          <span className="block h-[7px] w-[2px] rounded-[var(--radius-pill)] bg-current" />
          <span className="block h-[9px] w-[2px] rounded-[var(--radius-pill)] bg-current" />
          <span className="ml-1 block h-[7px] w-[12px] rounded-[var(--radius-tag)] border border-current" />
        </span>
      </div>

      <header className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <span aria-hidden className="text-[0.625rem] leading-none text-ink-3">
          &lsaquo;
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.5625rem] font-medium leading-tight text-ink">Transfer request</span>
        <Stamp verdict="STEP_UP" className="shrink-0" />
      </header>

      {/* The body is one flex column and the camera is the only thing in it that grows. A handset
          is 9:18 whatever size it is drawn at, so every fixed row has to be small enough that the
          face still has room at gallery scale — where the whole screen is barely 110px wide. */}
      <div className="flex min-h-0 flex-1 flex-col px-2.5 py-1.5">
        <div className="flex shrink-0 items-baseline justify-between gap-2">
          <Label>Asset</Label>
          <Mono className="truncate text-ink-3">{id}</Mono>
        </div>
        <p className="shrink-0 truncate text-[0.5625rem] font-medium leading-snug text-ink">{asset.name}</p>

        <div className="relative mt-1.5 min-h-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-console">
          <FaceField className="absolute inset-0" />
          <span aria-hidden className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-tl-[var(--radius-tag)] border-l-2 border-t-2 border-brass" />
          <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-tr-[var(--radius-tag)] border-r-2 border-t-2 border-brass" />
          <span aria-hidden className="absolute bottom-1.5 left-1.5 h-2.5 w-2.5 rounded-bl-[var(--radius-tag)] border-b-2 border-l-2 border-brass" />
          <span aria-hidden className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-br-[var(--radius-tag)] border-b-2 border-r-2 border-brass" />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-console-2 px-1.5 py-[3px]">
            <Mono className="truncate text-console-muted">hold still</Mono>
            <Mono className="shrink-0 text-console-accent">{score}</Mono>
          </span>
        </div>
      </div>

      <div className="shrink-0 px-2.5 pb-2 pt-1">
        {/* The primary action is INK, on the phone as everywhere else. */}
        <span className="block rounded-[var(--radius-pill)] bg-ink px-2 py-1.5 text-center text-[0.5625rem] font-medium leading-tight text-paper">Verify my face</span>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MEDIUM — component cards, the body of a gallery card or a feature-section visual
// ═════════════════════════════════════════════════════════════════════════════

/**
 * THE ASSET PASSPORT. Thumbnail, owner DID, content hash, lineage, live trust — the four claims an
 * asset makes about itself, in the order an auditor checks them.
 *
 * `compact` drops the key/value block, leaving a header and a trust line: that is the variant the
 * collage in feature section D overlaps at three different scales.
 */
export function PassportCard({ className, compact, seed = 0 }: { className?: string; compact?: boolean; seed?: number }) {
  const asset = pick(ASSETS, seed, 31);
  const uid = pick(ASSET_UIDS, seed, 32);
  const did = pick(DIDS, seed, 33);
  const sha = pick(HASHES, seed, 34);
  const trust = span(seed, 35, 62, 97);
  const versions = span(seed, 36, 2, 9);
  const block = span(seed, 37, 48120, 72890);

  return (
    <article aria-hidden className={cx("@container w-full min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper", className)}>
      <header className="flex items-start gap-2 border-b border-line bg-paper-2 p-2.5 @lg:gap-3 @lg:p-4">
        <AssetGlyph shape={asset.shape} className="h-8 w-8 @lg:h-11 @lg:w-11" />
        <div className="min-w-0 flex-1">
          <Label>Asset passport</Label>
          <p className="truncate text-[0.6875rem] font-medium leading-snug text-ink @lg:text-[0.9375rem]">{asset.name}</p>
          <Mono className="mt-px block truncate text-ink-3">
            {uid} · {asset.sub}
          </Mono>
        </div>
        <Tag tone="steel" glyph="◆" className="shrink-0">
          Verified
        </Tag>
      </header>

      {!compact && (
        <dl className="divide-y divide-line-faint px-2.5 @lg:px-4">
          {[
            { k: "Owner", v: did },
            { k: "SHA-256", v: shortHash(sha, 8) },
            { k: "Lineage", v: `${versions} versions · 1 branch` },
          ].map((row) => (
            <div key={row.k} className="flex items-baseline justify-between gap-3 py-1.5 @lg:py-2">
              <dt className="shrink-0 text-[0.5rem] uppercase leading-[1.6] tracking-[0.08em] text-ink-3 @lg:text-[0.625rem]">{row.k}</dt>
              <dd className="min-w-0 truncate text-right">
                <Mono className="text-ink">{row.v}</Mono>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="border-t border-line p-2.5 @lg:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Asset trust</Label>
          <Mono className={cx("font-medium", TEXT_TONE[trustTone(trust)])}>{trust}</Mono>
        </div>
        <Bar value={trust} tone={trustTone(trust)} className="mt-1 @lg:h-1.5" />
        <div className="mt-2 flex flex-wrap items-center gap-1 @lg:gap-1.5">
          <Tag tone="good" glyph="●">
            Anchored #{block}
          </Tag>
          <Tag tone="neutral" glyph="▮">
            Integrity intact
          </Tag>
        </div>
      </div>
    </article>
  );
}

/**
 * THE PROOF-OF-ACTION CERTIFICATE. The five verifications, ticked, each with the value it actually
 * produced — not five green ticks, which prove nothing, but five measurements a stranger can
 * re-run. The near-black footer is the same well `DecisionTracePanel` puts its policy line in:
 * signature and anchor are machine-made material and are dressed as such.
 */
export function ProofCertificate({ className, seed = 0, label }: { className?: string; seed?: number; label?: string }) {
  const id = pick(RECORD_IDS, seed, 41);
  const sha = pick(HASHES, seed, 42);
  const tx = pick(TX_IDS, seed, 43);
  const block = span(seed, 44, 48120, 72890);
  const faceScore = (span(seed, 45, 88, 98) / 100).toFixed(2);
  const liveScore = (span(seed, 46, 90, 99) / 100).toFixed(2);

  const checks: { n: string; label: string; value: string }[] = [
    { n: "01", label: "Employee ID claimed", value: "matched" },
    { n: "02", label: "ID document integrity", value: shortHash(sha, 4) },
    { n: "03", label: "Face match confidence", value: faceScore },
    { n: "04", label: "Liveness", value: liveScore },
    { n: "05", label: "Key signature", value: "Ed25519" },
  ];

  return (
    <figure
      role="img"
      aria-label={label ?? "Proof-of-Action certificate: all five verifications passed and the record is anchored to the ledger"}
      className={cx("@container w-full min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper", className)}
    >
      <header className="flex items-start gap-2 border-b border-line bg-paper-2 p-2.5 @lg:p-4">
        <div className="min-w-0 flex-1">
          <Label>Proof of Action</Label>
          <p className="truncate text-[0.75rem] font-semibold leading-snug tracking-[-0.02em] text-ink @lg:font-display @lg:text-[1.0625rem]">Certificate of verification</p>
          <Mono className="mt-px block truncate text-ink-3">
            {id} · issued {pick(CLOCKS, seed, 47)} UTC
          </Mono>
        </div>
        {/* The seal. Two rings and a tick, tilted six degrees — five is invisible, ten is a sticker. */}
        <span aria-hidden className="grid h-9 w-9 shrink-0 -rotate-6 place-items-center rounded-[var(--radius-pill)] border-2 border-verdigris-line bg-verdigris-soft text-verdigris @lg:h-12 @lg:w-12">
          <span className="grid h-[80%] w-[80%] place-items-center rounded-[var(--radius-pill)] border border-dashed border-verdigris-line">
            <span className="text-[0.625rem] leading-none @lg:text-[0.875rem]">✓</span>
          </span>
        </span>
      </header>

      <ol className="divide-y divide-line-faint px-2.5 @lg:px-4">
        {checks.map((c) => (
          <li key={c.n} className="flex items-center gap-2 py-1.5 @lg:gap-2.5 @lg:py-2">
            <Mono className="w-3 shrink-0 text-ink-4 @lg:w-4">{c.n}</Mono>
            <Pip tone="good" glyph="✓" />
            <span className="min-w-0 flex-1 truncate text-[0.5625rem] leading-snug text-ink-2 @lg:text-[0.8125rem]">{c.label}</span>
            <Mono className="shrink-0 text-ink">{c.value}</Mono>
          </li>
        ))}
      </ol>

      <footer className="flex items-center justify-between gap-2 border-t border-line bg-console px-2.5 py-1.5 @lg:px-4 @lg:py-2.5">
        <Mono className="min-w-0 truncate text-console-muted">
          sig {shortHash(sha, 5)} · {tx.slice(0, 10)}…
        </Mono>
        <span className="flex shrink-0 items-center gap-1">
          <Dot tone="good" />
          <Mono className="text-console-text">#{block}</Mono>
        </span>
      </footer>
    </figure>
  );
}

// The trace corpus. Three verdicts, five checks each, the points adding to a score that is exactly
// the number the stamp claims — the arithmetic is the argument, so it has to hold.
const TRACE_SETS: Record<MockupVerdict, { rows: { n: string; label: string; points: number; max: number; state: "pass" | "warn" | "fail" }[]; policy: string }> = {
  ALLOW: {
    policy: "asset.access v7",
    rows: [
      { n: "01", label: "Identity verified", points: 24, max: 24, state: "pass" },
      { n: "02", label: "Device recognised", points: 18, max: 20, state: "pass" },
      { n: "03", label: "Policy matched", points: 20, max: 20, state: "pass" },
      { n: "04", label: "Risk overlay clear", points: 16, max: 20, state: "warn" },
      { n: "05", label: "Ownership proven", points: 13, max: 16, state: "pass" },
    ],
  },
  STEP_UP: {
    policy: "asset.download v7",
    rows: [
      { n: "01", label: "Identity verified", points: 24, max: 24, state: "pass" },
      { n: "02", label: "Device unrecognised", points: 6, max: 20, state: "warn" },
      { n: "03", label: "Policy matched", points: 20, max: 20, state: "pass" },
      { n: "04", label: "Risk overlay elevated", points: 9, max: 20, state: "warn" },
      { n: "05", label: "Ownership proven", points: 13, max: 16, state: "pass" },
    ],
  },
  DENY: {
    policy: "asset.transfer v7",
    rows: [
      { n: "01", label: "Identity verified", points: 24, max: 24, state: "pass" },
      { n: "02", label: "Device unrecognised", points: 0, max: 20, state: "fail" },
      { n: "03", label: "Policy denies transfer", points: 0, max: 20, state: "fail" },
      { n: "04", label: "Risk overlay high", points: 4, max: 20, state: "warn" },
      { n: "05", label: "Ownership unproven", points: 0, max: 16, state: "fail" },
    ],
  },
};

const STATE_TONE: Record<"pass" | "warn" | "fail", MTone> = { pass: "good", warn: "warn", fail: "bad" };
const STATE_GLYPH: Record<"pass" | "warn" | "fail", string> = { pass: "✓", warn: "⚠", fail: "✗" };

/**
 * THE DECISION TRACE. Ordered check rows, each with its value and its contribution — the visual
 * proof behind "every decision explains itself". A failed row keeps its oxide tint at rest, the
 * way `TraceRow` does, and bleeds past the text column so it reads as a ROW and not as a
 * highlighted word.
 */
export function DecisionTrace({ className, verdict = "ALLOW", seed = 0, label }: { className?: string; verdict?: MockupVerdict; seed?: number; label?: string }) {
  const set = TRACE_SETS[verdict];
  const total = set.rows.reduce((sum, r) => sum + r.points, 0);
  const id = pick(RECORD_IDS, seed, 51);
  const latency = span(seed, 52, 96, 178);
  const policyHash = pick(HASHES, seed, 53);

  return (
    <figure
      role="img"
      aria-label={label ?? `Decision trace: five ordered checks totalling ${total} of 100, verdict ${verdict}`}
      className={cx("@container w-full min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper", className)}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line bg-paper-2 p-2.5 @lg:p-4">
        <div className="min-w-0">
          <Label>Decision trace</Label>
          <Mono className="block truncate text-ink-2">
            {id} · {latency} ms
          </Mono>
        </div>
        <Stamp verdict={verdict} big className="shrink-0" />
      </header>

      <ol className="px-2.5 py-0.5 @lg:px-4 @lg:py-1">
        {set.rows.map((r) => (
          <li
            key={r.n}
            className={cx(
              "flex items-center gap-2 border-b border-line-faint py-1.5 last:border-0 @lg:gap-2.5 @lg:py-2",
              r.state === "fail" && "-mx-2.5 bg-oxide-soft/60 px-2.5 @lg:-mx-4 @lg:px-4",
            )}
          >
            <Mono className="w-3 shrink-0 text-ink-4 @lg:w-4">{r.n}</Mono>
            <Pip tone={STATE_TONE[r.state]} glyph={STATE_GLYPH[r.state]} />
            <span className={cx("min-w-0 flex-1 truncate text-[0.5625rem] leading-snug @lg:text-[0.8125rem]", r.state === "fail" ? "text-ink" : "text-ink-2")}>{r.label}</span>
            <span className="hidden w-10 shrink-0 @sm:block @lg:w-16">
              <Bar value={(r.points / r.max) * 100} tone={STATE_TONE[r.state]} />
            </span>
            <Mono className={cx("w-9 shrink-0 text-right @lg:w-11", TEXT_TONE[STATE_TONE[r.state]])}>
              {r.points}/{r.max}
            </Mono>
          </li>
        ))}
      </ol>

      <footer className="flex items-center justify-between gap-2 border-t border-line bg-console px-2.5 py-1.5 @lg:px-4 @lg:py-2.5">
        <Mono className="min-w-0 truncate text-console-muted">
          policy {set.policy} · {shortHash(policyHash, 4)}
        </Mono>
        <Mono className="shrink-0 text-console-text">{total}/100</Mono>
      </footer>
    </figure>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTRA-LARGE — the immersive figures
// ═════════════════════════════════════════════════════════════════════════════

/**
 * THE LEDGER. Four blocks, each carrying the hash of the one before it, and the newest one still
 * being anchored. The whole argument of "the ledger is the source of truth, the database is a
 * cache" is in the connector labels: `prev` on the right of a block is `sha` on the left of the
 * next, which is why they are the same six characters and why breaking one breaks all of them.
 *
 * Sized as a section figure. It survives narrow containers by hiding the connector labels first
 * and the record counts second, never by wrapping the chain onto two lines.
 */
export function LedgerChain({ className, seed = 0, label }: { className?: string; seed?: number; label?: string }) {
  const head = span(seed, 61, 48120, 72880);
  const shas = rotate(HASHES, seed, 62).slice(0, 5);
  const blocks = [0, 1, 2, 3].map((i) => ({
    height: head + i,
    sha: shas[i]!,
    prev: i === 0 ? shas[4]! : shas[i - 1]!,
    records: span(seed, 63 + i, 6, 41),
    anchoring: i === 3,
  }));
  const id = pick(RECORD_IDS, seed, 68);

  return (
    <figure
      role="img"
      aria-label={label ?? "A hash chain of four ledger blocks: each block carries the hash of the one before it, and the newest is being anchored"}
      className={cx("@container w-full min-w-0 overflow-hidden", className)}
    >
      <div className="flex w-full items-stretch">
        {blocks.map((b, i) => (
          <div key={b.height} className="flex min-w-0 flex-1 items-stretch">
            {i > 0 && (
              <div aria-hidden className="flex w-4 shrink-0 flex-col items-center justify-center @lg:w-10 @3xl:w-16">
                <span className="hidden truncate @2xl:block">
                  <Mono className="text-ink-4">prev</Mono>
                </span>
                <span className="flex w-full items-center">
                  <span className="h-px flex-1 bg-line-strong" />
                  <span className="ml-px text-[0.5rem] leading-none text-ink-4 @lg:text-[0.625rem]">▸</span>
                </span>
                <span className="hidden truncate @2xl:block">
                  <Mono className="text-ink-4">{b.prev.slice(0, 6)}</Mono>
                </span>
              </div>
            )}
            <div
              className={cx(
                "flex min-w-0 flex-1 flex-col justify-between gap-1 rounded-[var(--radius-panel)] border p-1.5 @lg:gap-2 @lg:p-3 @3xl:p-4",
                b.anchoring ? "border-verdigris-line bg-verdigris-soft/40" : "border-line bg-overlay-1",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <Mono className={cx("font-medium", b.anchoring ? "text-verdigris" : "text-ink")}>#{b.height}</Mono>
                <Dot tone={b.anchoring ? "good" : "neutral"} />
              </div>
              <div className="min-w-0">
                <span className="block truncate">
                  <Mono className="text-ink-3">sha {b.sha.slice(0, 6)}</Mono>
                </span>
                <span className="hidden truncate @lg:block">
                  <Mono className="text-ink-4">prev {b.prev.slice(0, 6)}</Mono>
                </span>
              </div>
              <div className="hidden @sm:block">
                {b.anchoring ? (
                  <Tag tone="good" glyph="●">
                    Anchoring
                  </Tag>
                ) : (
                  <Mono className="text-ink-4">{b.records} records</Mono>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 @lg:mt-4 @lg:gap-x-3 @lg:pt-3">
        <Mono className="text-ink-2">{id}</Mono>
        <span aria-hidden className="text-[0.5rem] leading-none text-ink-4 @lg:text-[0.625rem]">
          →
        </span>
        <Mono className="text-ink-2">block #{head + 3}</Mono>
        <Tag tone="good" glyph="✓">
          2 confirmations
        </Tag>
        <span className="ml-auto hidden @lg:block">
          <Mono className="text-ink-3">independently verifiable</Mono>
        </span>
      </div>
    </figure>
  );
}

/**
 * The camera field. An abstract head, a depth mesh and five landmarks over the near-black — enough
 * to read as "a face is being measured" from across a room, and deliberately not enough to read as
 * a particular person. Strokes are non-scaling, so the drawing stays a hairline drawing whether it
 * is 96px in a card or 480px in a feature band.
 */
function FaceField({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={cx("h-full w-full", className)} fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {/* the instrument lattice */}
      <g stroke="var(--color-console-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.55">
        <path d="M0 30h120M0 60h120M0 90h120M30 0v120M60 0v120M90 0v120" />
      </g>
      {/* shoulders, then the head */}
      <g stroke="var(--color-console-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
        <path d="M24 120c2-16 15-26 36-26s34 10 36 26" opacity="0.5" />
        <ellipse cx="60" cy="52" rx="25" ry="31" />
        <path d="M40 44c4-2 9-2 12 0M68 44c3-2 8-2 12 0" opacity="0.7" />
        <path d="M60 50v11l-4 3" opacity="0.7" />
        <path d="M52 71c5 3 11 3 16 0" opacity="0.7" />
      </g>
      {/* the depth mesh: three arcs that say "this is being measured, not photographed" */}
      <g stroke="var(--color-console-accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.4">
        <path d="M37 38c14 6 32 6 46 0M35 55c15 8 35 8 50 0M40 70c12 7 28 7 40 0" />
        <path d="M60 22v60" />
      </g>
      {/* the landmarks the matcher actually keys on */}
      <g fill="var(--color-console-accent)">
        <circle cx="46" cy="45" r="2" />
        <circle cx="74" cy="45" r="2" />
        <circle cx="60" cy="61" r="2" />
        <circle cx="50" cy="72" r="2" />
        <circle cx="70" cy="72" r="2" />
      </g>
    </svg>
  );
}

const GATES: readonly { n: string; label: string; value: string }[] = [
  { n: "01", label: "Employee ID", value: "matched" },
  { n: "02", label: "ID document", value: "sha ok" },
  { n: "03", label: "Face match", value: "0.94" },
  { n: "04", label: "Liveness", value: "passed" },
  { n: "05", label: "Key signature", value: "Ed25519" },
];

/**
 * THE LIVENESS GATE — the visual behind "it checks the person, not the password". A camera field
 * with a brass reticle, and beside it the five gates taking their turn in the fixed order the
 * gateway evaluates them, exactly as `AuthAside` shows them.
 *
 * The in-flight gate may run `.auth-gate-fill` once — the only animation in this file, licensed
 * because the fill IS the meaning: it is elapsed time on a measurement. It runs once and stops,
 * it is covered by the exhaustive reduced-motion block in globals.css, and `Mockup` passes
 * `animate={false}` so nothing in a 36-card gallery ever moves by itself.
 */
export function LivenessGate({ className, seed = 0, animate = true, label }: { className?: string; seed?: number; animate?: boolean; label?: string }) {
  const at = span(seed, 71, 2, 4);
  const score = (span(seed, 72, 90, 98) / 100).toFixed(2);

  return (
    <figure
      role="img"
      aria-label={label ?? "A live face being measured, beside the five verifications filling in order"}
      className={cx("@container w-full min-w-0 overflow-hidden rounded-[var(--radius-media)] border border-line bg-paper", className)}
    >
      {/* The camera column is a PROPORTION, not a fixed width: a gallery card is ~360px and a
          feature-section figure is ~640px, and a fixed 14rem camera is a postage stamp in one and
          the whole visual in the other. It caps at 18rem so an immersive band does not turn into
          one enormous face. */}
      <div className="grid grid-cols-[40%_minmax(0,1fr)] @2xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* ── the camera ── */}
        <div className="relative aspect-square w-full overflow-hidden border-r border-line bg-console">
          <FaceField className="absolute inset-0" />
          {/* the reticle: brass is agency, and the corner is where a viewfinder puts it */}
          <span aria-hidden className="absolute left-2 top-2 h-3 w-3 rounded-tl-[var(--radius-tag)] border-l-2 border-t-2 border-brass @lg:h-5 @lg:w-5" />
          <span aria-hidden className="absolute right-2 top-2 h-3 w-3 rounded-tr-[var(--radius-tag)] border-r-2 border-t-2 border-brass @lg:h-5 @lg:w-5" />
          <span aria-hidden className="absolute bottom-2 left-2 h-3 w-3 rounded-bl-[var(--radius-tag)] border-b-2 border-l-2 border-brass @lg:h-5 @lg:w-5" />
          <span aria-hidden className="absolute bottom-2 right-2 h-3 w-3 rounded-br-[var(--radius-tag)] border-b-2 border-r-2 border-brass @lg:h-5 @lg:w-5" />
          <span className="absolute inset-x-2 top-2 flex justify-center @lg:top-3">
            <span className="rounded-[var(--radius-pill)] bg-console-2 px-1.5 py-px">
              <Mono className="text-console-muted">live · 30 fps</Mono>
            </span>
          </span>
          <span className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 @lg:inset-x-3 @lg:bottom-3">
            <span className="rounded-[var(--radius-tag)] border border-brass-line bg-console-2 px-1.5 py-px">
              <Mono className="text-console-accent">liveness {score}</Mono>
            </span>
            <span className="rounded-[var(--radius-tag)] bg-console-2 px-1.5 py-px">
              <Mono className="text-console-muted">depth ✓</Mono>
            </span>
          </span>
        </div>

        {/* ── the gates ── */}
        <div className="p-2.5 @lg:p-4">
          <div className="flex items-baseline justify-between gap-2">
            <Label>Five verifications</Label>
            <Mono className="text-ink-3">{at + 1}/5</Mono>
          </div>
          <ol className="relative mt-1.5 @lg:mt-3">
            {/* the spine: the same five checks in the same order every time */}
            <span aria-hidden className="pointer-events-none absolute bottom-3 left-[7px] top-3 w-px bg-line-faint @lg:left-[9px]" />
            {GATES.map((gate, i) => {
              const passed = i < at;
              const live = i === at;
              const tone: MTone = passed ? "good" : live ? "brass" : "neutral";
              return (
                <li key={gate.n} className="relative py-1 @lg:py-1.5">
                  <div className="relative flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cx(
                        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[var(--radius-pill)] border text-[0.5rem] font-semibold leading-none @lg:h-[1.125rem] @lg:w-[1.125rem] @lg:text-[0.625rem]",
                        tone === "neutral" ? "border-line bg-paper-2 text-ink-4" : CHIP_TONE[tone],
                      )}
                    >
                      {passed ? "✓" : live ? "●" : "·"}
                    </span>
                    <Mono className="shrink-0 text-ink-4">{gate.n}</Mono>
                    <span className={cx("min-w-0 flex-1 truncate text-[0.5625rem] leading-snug @lg:text-[0.8125rem]", live ? "text-ink" : passed ? "text-ink-2" : "text-ink-3")}>
                      {gate.label}
                    </span>
                    <Mono className={cx("shrink-0", tone === "neutral" ? "text-ink-4" : TEXT_TONE[tone])}>{passed || live ? gate.value : "—"}</Mono>
                  </div>
                  {/* the hairline fills for exactly one beat, then holds dim */}
                  <span aria-hidden className="mt-1 block h-px bg-line-faint">
                    {passed ? (
                      <span className="block h-px bg-verdigris/40" />
                    ) : (
                      live && <span className={cx("block h-px w-full origin-left bg-brass", animate ? "auth-gate-fill" : "scale-x-[0.42]")} />
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </figure>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MICRO — the parts that drop inside another mockup
// ═════════════════════════════════════════════════════════════════════════════

const METERS: readonly { label: string; note: string }[] = [
  { label: "Identity trust", note: "re-verified 4m ago" },
  { label: "Device trust", note: "known device · 41d" },
  { label: "Asset trust", note: "integrity intact" },
  { label: "Session trust", note: "decays in 26m" },
];

/**
 * A single trust meter: label, value, track, and the one line of evidence that makes the number
 * mean something. Small enough to sit inside a passport, a drawer or a card footer.
 */
export function TrustMeter({ className, seed = 0 }: { className?: string; seed?: number }) {
  const meter = pick(METERS, seed, 81);
  const value = span(seed, 82, 41, 97);
  const tone = trustTone(value);
  return (
    <div aria-hidden className={cx("@container w-full min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="truncate">{meter.label}</Label>
        <Mono className={cx("shrink-0 font-medium", TEXT_TONE[tone])}>{value}</Mono>
      </div>
      <Bar value={value} tone={tone} className="mt-1 @lg:h-1.5" />
      <span className="mt-1 flex items-center gap-1 truncate">
        <Dot tone={tone} />
        <Mono className="truncate text-ink-3">{meter.note}</Mono>
      </span>
    </div>
  );
}

/**
 * One line of cryptographic material and its verdict. The smallest complete idea in the product:
 * here is the hash, here is whether it still matches.
 */
/**
 * Whether a given hash row still matches. One row in seven does not, because a product that only
 * ever draws itself passing is a toy — and because the oxide variant is the one a viewer actually
 * needs to have seen. Exported as a predicate so a caption above a row can never disagree with it.
 */
function hashIntact(seed: number): boolean {
  return mix(seed, 86) % 7 !== 0;
}

export function HashRow({ className, seed = 0, intact }: { className?: string; seed?: number; intact?: boolean }) {
  const sha = pick(HASHES, seed, 85);
  const matches = intact ?? hashIntact(seed);
  return (
    <div
      aria-hidden
      className={cx(
        "@container flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-panel)] border px-2 py-1.5 @lg:gap-3 @lg:px-3 @lg:py-2",
        matches ? "border-line bg-paper-2" : "border-oxide-line bg-oxide-soft/60",
        className,
      )}
    >
      <Label className="shrink-0">sha-256</Label>
      <Mono className="min-w-0 flex-1 truncate text-ink-2">{sha}</Mono>
      <Tag tone={matches ? "good" : "bad"} glyph={matches ? "✓" : "✗"} className="shrink-0">
        {matches ? "matches" : "altered"}
      </Tag>
    </div>
  );
}

/**
 * The verdict, as a tile: the stamp, the one-line reason, and the three numbers an operator reads
 * next. It carries a real label because in a feature section it IS the argument; inside `Mockup`
 * the surrounding card already says the same thing and the whole tile is hidden instead.
 */
const TILE_TONE: Record<MTone, string> = {
  neutral: "border-line",
  brass: "border-brass-line",
  steel: "border-steel-line",
  good: "border-verdigris-line",
  warn: "border-saffron-line",
  bad: "border-oxide-line",
};

export function VerdictTile({ className, verdict = "ALLOW", seed = 0, label }: { className?: string; verdict?: MockupVerdict; seed?: number; label?: string }) {
  const tone = VERDICT_TONE[verdict];
  const trust = verdict === "ALLOW" ? span(seed, 91, 84, 97) : verdict === "STEP_UP" ? span(seed, 91, 52, 74) : span(seed, 91, 12, 38);
  const risk = 100 - trust - span(seed, 92, 0, 6);
  const latency = span(seed, 93, 96, 178);
  const reason =
    verdict === "ALLOW"
      ? "Live face matched · device known"
      : verdict === "STEP_UP"
        ? "New device · re-verification required"
        : "Ownership unproven · policy denies";

  return (
    <div
      role="img"
      aria-label={label ?? `Verdict ${verdict}, trust ${trust} of 100, decided in ${latency} milliseconds`}
      // The tile takes the RIM of its verdict but keeps the ground: the stamp inside carries the
      // wash, and a soft wash on a soft wash is two tints and no stamp.
      className={cx("@container w-full min-w-0 overflow-hidden rounded-[var(--radius-card)] border bg-paper p-2.5 @lg:p-4", TILE_TONE[tone], className)}
    >
      <Stamp verdict={verdict} big />
      <p className="mt-1.5 truncate text-[0.5625rem] leading-snug text-ink-2 @lg:mt-2.5 @lg:text-[0.8125rem]">{reason}</p>
      <div className="mt-2 flex items-center gap-3 border-t border-line-faint pt-1.5 @lg:mt-3 @lg:gap-6 @lg:pt-2.5">
        {[
          { k: "trust", v: String(trust) },
          { k: "risk", v: String(Math.max(3, risk)) },
          { k: "in", v: `${latency}ms` },
        ].map((s) => (
          <span key={s.k} className="min-w-0">
            <Label className="truncate">{s.k}</Label>
            <Mono className="block truncate text-ink">{s.v}</Mono>
          </span>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SMALL INSTRUMENTS — matrix, timeline, graph
// ═════════════════════════════════════════════════════════════════════════════

type Perm = "allow" | "step_up" | "deny";

const PERM_TONE: Record<Perm, MTone> = { allow: "good", step_up: "warn", deny: "bad" };
const PERM_GLYPH: Record<Perm, string> = { allow: "✓", step_up: "⚠", deny: "✗" };
const PERM_WORD: Record<Perm, string> = { allow: "allow", step_up: "step up", deny: "deny" };

const MATRIX_SETS: readonly { action: string; now: Perm; normal: Perm }[][] = [
  [
    { action: "open", now: "allow", normal: "allow" },
    { action: "download", now: "step_up", normal: "allow" },
    { action: "transfer", now: "deny", normal: "step_up" },
    { action: "sign", now: "deny", normal: "allow" },
  ],
  [
    { action: "open", now: "allow", normal: "allow" },
    { action: "download", now: "allow", normal: "allow" },
    { action: "transfer", now: "step_up", normal: "step_up" },
    { action: "sign", now: "step_up", normal: "allow" },
  ],
  [
    { action: "open", now: "step_up", normal: "allow" },
    { action: "download", now: "deny", normal: "allow" },
    { action: "transfer", now: "deny", normal: "step_up" },
    { action: "sign", now: "deny", normal: "deny" },
  ],
  [
    { action: "open", now: "allow", normal: "allow" },
    { action: "download", now: "step_up", normal: "step_up" },
    { action: "transfer", now: "deny", normal: "deny" },
    { action: "sign", now: "allow", normal: "allow" },
  ],
  [
    { action: "open", now: "allow", normal: "allow" },
    { action: "download", now: "allow", normal: "allow" },
    { action: "transfer", now: "allow", normal: "allow" },
    { action: "sign", now: "step_up", normal: "step_up" },
  ],
];

/**
 * NOW versus NORMAL. The one table that makes continuous trust legible: what this person could do
 * on an ordinary day, and what they can do at this second. Rows that changed keep the tint of what
 * they changed TO, which is how `AccessMatrix` does it in the console.
 */
export function AccessMatrixMini({ className, seed = 0 }: { className?: string; seed?: number }) {
  const rows = pick(MATRIX_SETS, seed, 101);
  // The caption has to agree with the rows it explains: the more the NOW column has shrunk, the
  // lower the trust score that shrank it. A matrix full of denials captioned "trust 88" is a lie
  // an operator would spot in a second.
  const shrunk = rows.filter((r) => r.now !== r.normal).length;
  const trust = span(seed, 102, 78, 94) - shrunk * span(seed, 103, 9, 15);

  return (
    <div aria-hidden className={cx("@container w-full min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-paper-2 px-2 py-1.5 @lg:px-3 @lg:py-2">
        <Label className="truncate">Effective access</Label>
        <Mono className={cx("shrink-0", TEXT_TONE[trustTone(trust)])}>trust {trust}</Mono>
      </div>
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-line-faint">
            <th className="w-[34%] px-2 py-1 @lg:px-3">
              <Label>Action</Label>
            </th>
            <th className="px-2 py-1 @lg:px-3">
              <Label>Now</Label>
            </th>
            <th className="px-2 py-1 text-right @lg:px-3">
              <Label>Normally</Label>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changed = r.now !== r.normal;
            return (
              <tr key={r.action} className={cx("border-b border-line-faint last:border-0", changed && (r.now === "deny" ? "bg-oxide-soft/55" : "bg-saffron-soft/50"))}>
                <td className="truncate px-2 py-1 @lg:px-3 @lg:py-1.5">
                  <span className="block truncate text-[0.5625rem] font-medium leading-[1.5] text-ink @lg:text-[0.75rem]">{r.action}</span>
                </td>
                <td className="px-2 py-1 @lg:px-3 @lg:py-1.5">
                  <span className={cx("flex items-center gap-1 truncate text-[0.5rem] font-medium uppercase leading-[1.5] tracking-[0.06em] @lg:text-[0.625rem]", TEXT_TONE[PERM_TONE[r.now]])}>
                    <span aria-hidden className="font-mono leading-none">
                      {PERM_GLYPH[r.now]}
                    </span>
                    {PERM_WORD[r.now]}
                  </span>
                </td>
                <td className="px-2 py-1 text-right @lg:px-3 @lg:py-1.5">
                  <span className="inline-flex items-center gap-1 truncate text-[0.5rem] font-medium uppercase leading-[1.5] tracking-[0.06em] text-ink-3 @lg:text-[0.625rem]">
                    <span aria-hidden className="font-mono leading-none">
                      {PERM_GLYPH[r.normal]}
                    </span>
                    {PERM_WORD[r.normal]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Three days a session can have. Each is five moments, and each has exactly one moment that is
// the reason a person would ever open this timeline.
const TIMELINES: readonly (readonly { at: string; label: string; tone: MTone }[])[] = [
  [
    { at: "09:14", label: "Enrolled", tone: "steel" },
    { at: "10:41", label: "Device seen", tone: "neutral" },
    { at: "12:03", label: "Risk spike", tone: "bad" },
    { at: "14:32", label: "Step-up passed", tone: "warn" },
    { at: "16:20", label: "Anchored", tone: "good" },
  ],
  [
    { at: "08:02", label: "Signed in", tone: "steel" },
    { at: "08:47", label: "Asset opened", tone: "neutral" },
    { at: "11:26", label: "Transfer asked", tone: "warn" },
    { at: "11:27", label: "Denied", tone: "bad" },
    { at: "11:41", label: "Incident opened", tone: "bad" },
  ],
  [
    { at: "07:35", label: "Key rotated", tone: "steel" },
    { at: "09:58", label: "Policy v7 live", tone: "brass" },
    { at: "13:12", label: "Batch signed", tone: "good" },
    { at: "15:04", label: "Trust decayed", tone: "warn" },
    { at: "18:07", label: "Anchored", tone: "good" },
  ],
];

const TIMELINE_DAYS = ["01 Sep", "02 Sep", "03 Sep", "04 Sep"] as const;

/**
 * The day, as a rail. Five moments, one of them an incident — the "replay it years later" story in
 * its smallest honest form. The rail spans exactly the first to the last node because each item is
 * a fifth of the width and every node sits at its centre.
 */
export function TimelineStrip({ className, seed = 0 }: { className?: string; seed?: number }) {
  const steps = pick(TIMELINES, seed, 110);
  const cursor = mix(seed, 111) % steps.length;
  const day = pick(TIMELINE_DAYS, seed, 112);
  return (
    <div aria-hidden className={cx("@container w-full min-w-0 overflow-hidden", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="truncate">Session timeline</Label>
        <Mono className="shrink-0 text-ink-3">{day} · {steps.length} events</Mono>
      </div>
      <ol className="relative mt-2.5 flex w-full @lg:mt-4">
        <span aria-hidden className="pointer-events-none absolute left-[10%] right-[10%] top-[3px] h-px bg-line @lg:top-[4px]" />
        {steps.map((step, i) => (
          <li key={step.at} className="relative flex min-w-0 flex-1 flex-col items-center gap-1 px-px text-center">
            <span
              aria-hidden
              className={cx(
                "relative block h-[7px] w-[7px] shrink-0 rounded-[var(--radius-pill)] border-2 border-paper @lg:h-2.5 @lg:w-2.5",
                BAR_TONE[step.tone],
                i === cursor && "ring-2 ring-brass ring-offset-1 ring-offset-paper",
              )}
            />
            <Mono className="block w-full truncate text-ink-3">{step.at}</Mono>
            <span className={cx("block w-full truncate text-[0.5rem] leading-tight @lg:text-[0.6875rem]", i === cursor ? "font-medium text-ink" : "text-ink-3")}>{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The graph is laid out by hand rather than simulated. `TrustGraph` in trust.tsx runs a real force
// simulation because it draws real data; a mockup draws a KNOWN shape, and a hand-placed one reads
// better and can never settle into an ugly pose on a slow machine. Geometry is fixed; only the
// labels move with the seed, because the shape of a chain of custody IS the point.
type GraphNode = { id: string; x: number; y: number; r: number; fill: string; stroke: string };

const GRAPH_NODES: readonly GraphNode[] = [
  { id: "asset", x: 122, y: 74, r: 17, fill: "var(--color-brass-soft)", stroke: "var(--color-brass)" },
  { id: "person", x: 56, y: 40, r: 13, fill: "var(--color-steel-soft)", stroke: "var(--color-steel)" },
  { id: "device", x: 40, y: 106, r: 10, fill: "var(--color-overlay-2)", stroke: "var(--color-line-strong)" },
  { id: "policy", x: 186, y: 34, r: 11, fill: "var(--color-overlay-2)", stroke: "var(--color-ink-3)" },
  { id: "decision", x: 190, y: 110, r: 12, fill: "var(--color-verdigris-soft)", stroke: "var(--color-verdigris)" },
  { id: "block", x: 246, y: 74, r: 11, fill: "var(--color-ink)", stroke: "var(--color-ink)" },
];

const GRAPH_EDGES: readonly [string, string][] = [
  ["person", "asset"],
  ["device", "person"],
  ["device", "asset"],
  ["policy", "asset"],
  ["asset", "decision"],
  ["policy", "decision"],
  ["decision", "block"],
];

const POLICY_NAMES = ["policy v7", "policy v6", "policy v9", "policy v4"] as const;
const DEVICE_NAMES = ["MacBook Pro", "ThinkPad X1", "iPad Pro", "Latitude"] as const;

export function TrustGraphMini({ className, seed = 0 }: { className?: string; seed?: number }) {
  const lit = pick(GRAPH_NODES, seed, 121).id;
  const verdict = pick(VERDICTS, seed, 122);
  const asset = pick(ASSETS, seed, 123);
  const labels: Record<string, string> = {
    // The asset node carries the file stem: "turbine-blade-v7.step" is wider than the graph is.
    asset: asset.name.replace(/\.[a-z0-9]+$/, "").slice(0, 14),
    person: pick(ROLES, seed, 124),
    device: pick(DEVICE_NAMES, seed, 125),
    policy: pick(POLICY_NAMES, seed, 126),
    decision: verdict === "STEP_UP" ? "STEP UP" : verdict,
    block: `#${span(seed, 127, 48120, 72890)}`,
  };
  // The decision node is the one node whose HUE is data: it is the verdict, so it has to agree.
  const decisionTone: MTone = VERDICT_TONE[verdict];
  const decisionFill = `var(--color-${decisionTone === "good" ? "verdigris" : decisionTone === "warn" ? "saffron" : "oxide"}-soft)`;
  const decisionStroke = `var(--color-${decisionTone === "good" ? "verdigris" : decisionTone === "warn" ? "saffron" : "oxide"})`;
  const byId = new Map(GRAPH_NODES.map((n) => [n.id, n] as const));

  return (
    <div aria-hidden className={cx("@container mx-auto w-full min-w-0 max-w-[30rem] overflow-hidden", className)}>
      <svg viewBox="0 0 286 148" className="h-auto w-full" fill="none">
        {GRAPH_EDGES.map(([from, to]) => {
          const a = byId.get(from)!;
          const b = byId.get(to)!;
          const active = from === lit || to === lit;
          return (
            <line
              key={`${from}-${to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "var(--color-brass)" : "var(--color-line-strong)"}
              strokeWidth={active ? 1.6 : 1}
              strokeOpacity={active ? 1 : 0.75}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {GRAPH_NODES.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.id === "decision" ? decisionFill : n.fill}
              stroke={n.id === "decision" ? decisionStroke : n.stroke}
              strokeWidth={n.id === lit ? 2.2 : 1.25}
              vectorEffect="non-scaling-stroke"
            />
            {/* Labels take a halo of the ground: they cross edges constantly, and an unhaloed 8px
                label disappears into whatever line runs under it. */}
            <text
              x={n.x}
              y={n.y + n.r + 9}
              textAnchor="middle"
              className={cx("font-mono text-[8px]", n.id === lit ? "fill-[var(--color-ink)]" : "fill-[var(--color-ink-3)]")}
              stroke="var(--color-paper)"
              strokeWidth={3}
              style={{ paintOrder: "stroke" }}
            >
              {labels[n.id]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// THE DISPATCHER
// ═════════════════════════════════════════════════════════════════════════════

export type MockupKind =
  | "browser"
  | "phone"
  | "console"
  | "passport"
  | "proof"
  | "trace"
  | "ledger"
  | "liveness"
  | "trust"
  | "hash"
  | "verdict"
  | "matrix"
  | "timeline"
  | "graph";

export const MOCKUP_KINDS: readonly MockupKind[] = [
  "browser",
  "phone",
  "console",
  "passport",
  "proof",
  "trace",
  "ledger",
  "liveness",
  "trust",
  "hash",
  "verdict",
  "matrix",
  "timeline",
  "graph",
];

/**
 * A gallery card is a 4/3 well and a mockup is not: a console screen is landscape, a phone is
 * portrait, a hash row is a single line. `FIT` is how each kind meets the well — whether it fills
 * it edge to edge like a screenshot, hangs from the top so a long screen crops at the bottom the
 * way a real thumbnail does, or floats in the middle of a padded field.
 */
const FIT: Record<MockupKind, string> = {
  browser: "items-stretch justify-center p-3 @lg:p-5",
  phone: "items-center justify-center p-3 @lg:p-5",
  console: "items-stretch justify-center",
  passport: "items-center justify-center p-3 @lg:p-5",
  proof: "items-start justify-center p-3 @lg:p-5",
  trace: "items-start justify-center p-3 @lg:p-5",
  ledger: "items-center justify-center p-3 @lg:p-5",
  liveness: "items-center justify-center p-3 @lg:p-5",
  trust: "items-center justify-center p-4 @lg:p-6",
  hash: "items-center justify-center p-3 @lg:p-5",
  verdict: "items-center justify-center p-3 @lg:p-5",
  matrix: "items-center justify-center p-3 @lg:p-5",
  timeline: "items-center justify-center p-4 @lg:p-6",
  graph: "items-center justify-center p-3 @lg:p-5",
};

/**
 * THE ONE ENTRY POINT a gallery needs.
 *
 * `kind` picks the composition, `seed` varies its content deterministically, and `verdict` lets a
 * record whose chip says DENY show a mockup that also says DENY — a card whose picture contradicts
 * its own metadata is the fastest way to look fake. Omit it and the verdict is derived from the
 * seed, so a gallery still gets a believable spread.
 *
 * The wrapper is `aria-hidden` on purpose. Every one of these sits beside a title, a verdict chip
 * and a timestamp that already say what it shows; a screen reader hearing the picture described as
 * well would hear the same card twice. Compose the individual components directly in a feature
 * section and their own `role="img"` labels come back.
 */
export function Mockup({ kind, className, seed = 0, verdict }: { kind: MockupKind; className?: string; seed?: number; verdict?: MockupVerdict }) {
  const v = verdict ?? pick(VERDICTS, seed, 131);

  const body = (() => {
    switch (kind) {
      case "browser":
        return (
          <BrowserFrame url={pick(["vajra.app/decisions", "vajra.app/assets", "vajra.app/incidents"] as const, seed, 132)} className="h-full self-stretch">
            <ConsoleScreen seed={seed} />
          </BrowserFrame>
        );

      // A 9:18 handset in a 4:3 well: at ~34% of the well width the whole phone clears the
      // padding without ever being cropped at the chin, which is the one crop that reads as a bug
      // rather than as a composition.
      case "phone":
        return (
          <div className="w-[34%] min-w-[5rem] max-w-[11rem]">
            <PhoneFrame>
              <PhoneScreen seed={seed} />
            </PhoneFrame>
          </div>
        );

      case "console":
        return <ConsoleScreen seed={seed} className="self-stretch" />;

      case "passport":
        return <PassportCard seed={seed} />;

      case "proof":
        return <ProofCertificate seed={seed} />;

      case "trace":
        return <DecisionTrace seed={seed} verdict={v} />;

      case "ledger":
        return <LedgerChain seed={seed} />;

      case "liveness":
        return <LivenessGate seed={seed} animate={false} />;

      // ── the micro kinds, composed into something worth looking at ──
      case "trust":
        return (
          <div className="w-full space-y-2.5 rounded-[var(--radius-card)] border border-line bg-paper p-3 @lg:space-y-4 @lg:p-5">
            <div className="flex items-baseline justify-between gap-2 border-b border-line-faint pb-2">
              <Label className="truncate">{pick(ROLES, seed, 135)} · continuous trust</Label>
              <Mono className="shrink-0 truncate text-ink-3">{pick(DEVICES, seed, 133)}</Mono>
            </div>
            <TrustMeter seed={seed} />
            <TrustMeter seed={seed + 7} />
            <TrustMeter seed={seed + 13} />
          </div>
        );

      // The caption is derived from the rows, never asserted over them: a card that says "chain
      // intact" above a row stamped ALTERED is worse than no caption at all.
      case "hash": {
        const intact = hashIntact(seed) && hashIntact(seed + 5);
        return (
          <div className="w-full space-y-2">
            <HashRow seed={seed} />
            <HashRow seed={seed + 5} />
            <div className="flex items-center justify-between gap-2 px-1">
              <Mono className="truncate text-ink-3">{pick(RECORD_IDS, seed, 134)}</Mono>
              <Tag tone={intact ? "good" : "bad"} glyph={intact ? "✓" : "✗"}>
                {intact ? "chain intact" : "chain broken"}
              </Tag>
            </div>
          </div>
        );
      }

      // An ALLOW whose evidence row says ALTERED is a decision that should not have been an ALLOW.
      // The row is told what the verdict already implies rather than rolling for itself.
      case "verdict":
        return (
          <div className="w-full space-y-2.5">
            <VerdictTile seed={seed} verdict={v} />
            <HashRow seed={seed + 3} intact={v !== "DENY"} />
          </div>
        );

      case "matrix":
        return <AccessMatrixMini seed={seed} />;

      case "timeline":
        return (
          <div className="w-full rounded-[var(--radius-card)] border border-line bg-paper p-3 @lg:p-5">
            <TimelineStrip seed={seed} />
          </div>
        );

      case "graph":
        return (
          <div className="w-full">
            <TrustGraphMini seed={seed} />
            <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
              <Mono className="truncate text-ink-3">chain of custody</Mono>
              <Tag tone="steel" glyph="◆">
                6 nodes
              </Tag>
            </div>
          </div>
        );

      default:
        return null;
    }
  })();

  // Two elements, not one: an element cannot query the container it declares, so the outer div is
  // the container and the inner one is what reads it. That is what lets the fit padding step up in
  // a hero-sized well and stay tight in a gallery card.
  return (
    <div aria-hidden className={cx("@container relative h-full w-full min-w-0 overflow-hidden", className)}>
      <div className={cx("flex h-full w-full min-w-0", FIT[kind])}>{body}</div>
    </div>
  );
}
