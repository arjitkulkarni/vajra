"use client";

/**
 * The landing header. Sticky, hairline, and carrying the one piece of state a very long page owes
 * the reader: where they are in it.
 *
 * Two mechanisms, deliberately separate:
 *
 *   PROGRESS  a 2px brass rule along the top edge, driven by document scroll. It is a `scaleX` on a
 *             `transform-origin: left` element rather than a width, so it never lays out — a width
 *             transition on a full-bleed bar is a reflow on every frame of every scroll.
 *
 *   SPY       one IntersectionObserver over the five anchored bands, with a root margin that puts
 *             the "current" line a third of the way down the viewport rather than at its top edge.
 *             At the top edge a heading is current for the two pixels before it leaves, which reads
 *             as a flicker; a third of the way down, a section is current for as long as it is what
 *             you are actually reading.
 *
 * The mobile sheet is a plain conditional, not a portal: it is inside the sticky header, it is
 * dismissed by the same routes it links to, and a portal would have cost a focus trap for four
 * links.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Button, VajraMark, cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n-client";

/** In DOM order, which is the only order a scroll spy can be right about. */
const SECTIONS = ["problem", "engine", "build", "evidence", "numbers"] as const;

export function LandingHeader() {
  const { t, locale } = useI18n();
  const [progress, setProgress] = useState(0);
  const [lifted, setLifted] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const frame = useRef(0);

  // One rAF-coalesced scroll listener for both the rule and the header's own lift. Two listeners
  // reading the same scrollTop is two layout reads per frame for one number.
  useEffect(() => {
    const read = () => {
      frame.current = 0;
      const doc = document.documentElement;
      const span = doc.scrollHeight - doc.clientHeight;
      setProgress(span > 0 ? Math.min(1, Math.max(0, doc.scrollTop / span)) : 0);
      setLifted(doc.scrollTop > 8);
    };
    const onScroll = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const nodes = SECTIONS.map((id) => document.getElementById(id)).filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        // Take the topmost intersecting band rather than the last entry to fire: scrolling fast
        // through three sections delivers three entries in one callback, and the last one wins by
        // accident of ordering, not by being the one on screen.
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-33% 0px -60% 0px", threshold: 0 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  const login = `/${locale}/login`;
  const demo = `/${locale}/demo`;

  return (
    <header
      className={cx(
        "sticky top-0 z-50 border-b bg-paper/85 backdrop-blur-md transition-[border-color,box-shadow] duration-200 ease-out",
        lifted ? "border-line shadow-lift" : "border-transparent",
      )}
    >
      {/* Read progress. Decorative — the page already has a scrollbar, this is the editorial one. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] origin-left bg-brass"
        style={{ transform: `scaleX(${progress})` }}
      />

      <div className="shell flex items-center gap-4 py-3">
        <Link
          href={`/${locale}/landingpage`}
          className="group flex shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] text-ink"
        >
          <VajraMark className="h-6 w-6 text-brass transition-transform duration-200 ease-out-soft group-hover:scale-110" />
          <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em]">{t("brand.name")}</span>
        </Link>

        <nav className="ml-3 hidden items-center gap-0.5 lg:flex" aria-label={t("site.nav.product")}>
          {SECTIONS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "true" : undefined}
              className={cx(
                "rounded-[var(--radius-control)] px-2.5 py-1.5 text-[0.875rem] font-medium transition-[color,background-color] duration-150 ease-out active:translate-y-px",
                active === id ? "bg-brass-soft text-brass-deep" : "text-ink-3 hover:bg-overlay-2 hover:text-ink",
              )}
            >
              {t(`site.page.nav.${id}`)}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden md:block">
            <LocaleSwitcher compact />
          </span>
          <Link href={demo} className="hidden sm:block">
            <Button size="sm">{t("nav.startDemo")}</Button>
          </Link>
          <Link href={login}>
            <Button variant="primary" size="sm">
              {t("site.nav.signIn")}
            </Button>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? t("site.nav.closeMenu") : t("site.nav.menu")}
            className="tap grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-ink-2 transition-[color,background-color] duration-150 ease-out hover:bg-overlay-2 hover:text-ink lg:hidden"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              {open ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2.5 5h11M2.5 11h11" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="auth-panel border-t border-line bg-paper lg:hidden">
          <nav className="shell grid gap-1 py-3">
            {SECTIONS.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-control)] px-3 py-2.5 text-[0.9375rem] font-medium text-ink-2 transition-[color,background-color] duration-150 ease-out hover:bg-overlay-2 hover:text-ink"
              >
                {t(`site.page.nav.${id}`)}
              </a>
            ))}
            <div className="mt-2 border-t border-line-faint pt-3 md:hidden">
              <LocaleSwitcher compact />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
