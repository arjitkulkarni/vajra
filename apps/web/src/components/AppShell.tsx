"use client";

/**
 * The control-plane shell.
 *
 * The public site sells; this frame is for someone on shift. Navigation is grouped by the question
 * being asked — what is happening, who may do what, what is the asset, who is this person, can we
 * prove it, is the system healthy — rather than by the services underneath. The header always
 * carries three things an operator needs without clicking: the clock, the state of the system, and
 * whether an incident is live.
 *
 * Styling note: this is persistent chrome. It is on screen 100% of the time, so it recedes — the
 * ground everywhere, hairlines instead of second greys, and exactly one saturated moment (the
 * active nav item on brass). The header is a fixed 44px so the sidebar's sticky offset derives
 * from one number rather than from three different guesses.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, clearSession, isAuthenticated, setConsoleKey, type Me } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { navFor, type ConsoleArea, type NavBadge } from "@/lib/nav";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { CommandPalette } from "./CommandPalette";
import { EntityProvider } from "./EntityDrawer";
import { IdTag, Kbd, LiveClock, StateDot } from "./console";
import { Button, cx, Spinner, toneForTrust } from "./ui";

/**
 * One shell, two areas. `variant="admin"` is the control plane and carries every section; the
 * workspace carries the four an approved engineer, manager or auditor actually works in. The
 * grouping in both cases is by the operator's question, not by the architecture's module names.
 */
export function AppShell({ children, variant = "workspace" }: { children: React.ReactNode; variant?: ConsoleArea }) {
  const { t, n, locale } = useI18n();
  const pathname = usePathname() ?? "";
  const base = `/${locale}/${variant === "admin" ? "admin" : "app"}`;
  const nav = navFor(variant);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; down: number } | null>(null);
  /**
   * Work waiting on this operator, per badged nav item.
   *
   * `null` is "we could not ask", and it is deliberately NOT 0. Both render as no badge at all, so
   * an idle console looks idle — but they must never be the same value in state, because a 403 or a
   * dead gateway silently becoming "0 pending" is precisely the lie this release is removing from
   * the panels. The chrome does not get to claim a queue is empty on evidence it never received.
   */
  const [queued, setQueued] = useState<Record<NavBadge, number | null>>({ signups: null, approvals: null });

  const load = useCallback(async () => {
    if (!isAuthenticated()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then((h) => {
          if (!alive) return;
          const down = Object.values(h.deps ?? {}).filter((d) => !d?.ok).length;
          setHealth({ ok: down === 0, down });
        })
        .catch(() => alive && setHealth(null));
    void check();
    const id = setInterval(check, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Same cadence and the same alive/clearInterval shape as the health poll above — this is chrome
  // refreshing itself in the background, never something a page waits on. Admin only: the
  // workspace shell has no enrolment queue and no approval inbox of its own to count.
  useEffect(() => {
    if (variant !== "admin") return;
    let alive = true;
    const put = (badge: NavBadge, value: number | null) =>
      alive && setQueued((prev) => (prev[badge] === value ? prev : { ...prev, [badge]: value }));
    const check = () => {
      if (!isAuthenticated()) {
        put("signups", null);
        put("approvals", null);
        return;
      }
      void api
        .enrolments("pending")
        .then((rows) => put("signups", rows.length))
        .catch(() => put("signups", null));
      void api
        .approvals()
        .then((a) => put("approvals", a.inbox.length))
        .catch(() => put("approvals", null));
    };
    check();
    const id = setInterval(check, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [variant]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <EntityProvider>
      <div className="console-root min-h-screen bg-paper">
        <header className="sticky top-0 z-40 h-11 border-b border-line bg-paper/85 backdrop-blur-md">
          <div className="flex h-full items-center gap-3 px-3 lg:px-4">
            <button
              className="rounded-[var(--radius-control)] p-1.5 leading-none text-ink-2 transition-[color,background-color] duration-150 ease-out hover:bg-paper-2 hover:text-ink active:translate-y-px lg:hidden"
              onClick={() => setNavOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={navOpen}
            >
              ☰
            </button>
            <Link href={`/${locale}`} className="group flex shrink-0 items-center gap-2">
              <svg
                viewBox="0 0 28 28"
                className="h-[18px] w-[18px] text-brass transition-colors duration-150 ease-out group-hover:text-brass-deep"
                fill="none"
                aria-hidden
              >
                <path d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z" fill="currentColor" />
              </svg>
              <span className="font-display text-[0.9375rem] font-semibold leading-none tracking-[-0.015em]">{t("brand.name")}</span>
            </Link>
            <span className="eyebrow hidden border-l border-line pl-3 leading-none sm:inline">{t("console.shell.title")}</span>

            <button
              onClick={() => setPaletteOpen(true)}
              className="ml-2 hidden min-w-[220px] items-center gap-2 rounded-[var(--radius-control)] border border-line bg-overlay-1 px-2.5 py-1 text-left text-[0.8125rem] text-ink-3 transition-[color,background-color,border-color] duration-150 ease-out hover:border-line-strong hover:bg-paper-2 hover:text-ink-2 active:translate-y-px md:flex"
            >
              <span aria-hidden className="font-mono text-ink-3">
                ⌕
              </span>
              {t("console.shell.searchHint")}
              <span className="ml-auto flex items-center gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>

            <div className="ml-auto flex items-center gap-2.5">
              <span className="hidden items-center gap-1.5 lg:flex">
                <StateDot tone={health === null ? "neutral" : health.ok ? "good" : "bad"} pulse={!!health && !health.ok} />
                <span className="text-[0.75rem] text-ink-3">
                  {health === null
                    ? "—"
                    : health.ok
                      ? t("console.overview.operational")
                      : health.down === 1
                        ? t("console.overview.degraded", { n: health.down })
                        : t("console.overview.degradedMany", { n: health.down })}
                </span>
              </span>
              <span className="hidden tnum lg:inline">
                <LiveClock />
              </span>
              {me?.incident && (
                <Link
                  href={`${base}/incidents/${me.incident.incidentId}`}
                  className="shrink-0 transition-transform duration-150 ease-out-soft active:translate-y-px"
                >
                  <IdTag tone="bad">
                    <StateDot tone="bad" pulse /> {me.incident.incidentId} · {me.incident.severity}
                  </IdTag>
                </Link>
              )}
              <LocaleSwitcher compact />
              {loading ? (
                <Spinner className="text-ink-3" />
              ) : me ? (
                <div className="flex items-center gap-2">
                  <div className="hidden text-right sm:block">
                    <p className="text-[0.8125rem] font-medium leading-tight text-ink">{me.user.displayName}</p>
                    <p className="eyebrow leading-tight">{t(`roles.${me.user.role}`)}</p>
                  </div>
                  <IdTag tone={toneForTrust(me.user.identityTrust)} title={t("trust.identity")} className="tnum">
                    {me.user.identityTrust}
                  </IdTag>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // Drop BOTH credentials, or signing out of a console session does nothing:
                      // the cookie was never what authenticated it, and leaving the link banked in
                      // sessionStorage would land the operator straight back in the console.
                      clearSession();
                      setConsoleKey(null);
                      setMe(null);
                      location.href = `/${locale}/login`;
                    }}
                  >
                    {t("app.signOut")}
                  </Button>
                </div>
              ) : (
                <Link href={`/${locale}/login`}>
                  <Button size="sm" variant="primary">
                    {t("app.signIn")}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </header>

        <div className="flex">
          <aside
            className={cx(
              "fixed inset-y-0 left-0 z-30 flex w-[212px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper pt-11 shadow-float transition-transform duration-300 ease-out-soft",
              "lg:sticky lg:top-11 lg:h-[calc(100vh-44px)] lg:translate-x-0 lg:pt-0 lg:shadow-none",
              navOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <nav className="flex-1 space-y-5 px-2.5 py-4">
              {nav.map((section) => (
                <div key={section.group}>
                  <p className="eyebrow mb-1.5 px-2.5">{t(`console.shell.groups.${section.group}`)}</p>
                  <ul className="space-y-px">
                    {section.items.map((item) => {
                      const href = `${base}${item.href}`;
                      const active = item.href === "" ? pathname === base || pathname === `${base}/` : pathname.startsWith(href);
                      const waiting = item.badge ? queued[item.badge] : null;
                      return (
                        <li key={item.key}>
                          <Link
                            href={href}
                            onClick={() => setNavOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cx(
                              "relative flex items-center rounded-[var(--radius-control)] px-2.5 py-[6px] text-[0.8125rem] transition-[color,background-color] duration-150 ease-out",
                              active
                                ? "bg-brass-soft/60 font-medium text-ink"
                                : "text-ink-2 hover:bg-overlay-2 hover:text-ink active:translate-y-px",
                            )}
                          >
                            {active && (
                              <span
                                aria-hidden
                                className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-[var(--radius-pill)] bg-brass"
                              />
                            )}
                            <span className="truncate">{t(`console.shell.items.${item.key}`)}</span>
                            {/*
                              A number, not a dot: "3" is how much work, a dot is only "not zero".
                              Falsy covers both 0 and the null above, so an empty queue and an
                              unanswerable one are equally silent — the item looks exactly as it
                              does today. Brass because this is attention, not a verdict; the
                              oxide/saffron/verdigris vocabulary means something an operator reads
                              as state and a backlog of three is not a state.
                              The label carries the item's own name, so the link's accessible name
                              reads "Enrolment queue 3 pending" rather than a bare digit.
                            */}
                            {!!waiting && (
                              <span
                                className="ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-brass px-1.5 text-[0.6875rem] font-semibold leading-none tnum text-paper"
                                aria-label={t("console.system.outboxPending", { n: n(waiting) })}
                              >
                                {n(waiting)}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="mx-2.5 mb-4 rounded-[var(--radius-field)] border border-line-faint bg-overlay-1 px-2.5 py-2.5">
              <p className="text-[0.6875rem] leading-relaxed text-ink-3">{t("trust.vsRisk")}</p>
              <Link
                href={`/${locale}/demo`}
                className="mt-2 inline-block text-[0.6875rem] font-medium text-brass transition-colors duration-150 ease-out hover:text-brass-deep"
              >
                {t("demo.title")} →
              </Link>
            </div>
          </aside>

          {navOpen && <div className="fixed inset-0 z-20 bg-scrim backdrop-blur-[2px] lg:hidden" onClick={() => setNavOpen(false)} />}

          <main className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">
            <div className="mx-auto max-w-[1240px]">{children}</div>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </EntityProvider>
  );
}

/** Small helper used by pages that need the signed-in identity. */
/**
 * `enabled` exists for the admin gate, which must bank the console key out of the URL before the
 * first `/v1/me` goes out — otherwise the answer is a truthful "no console key" and the operator
 * who followed the right link watches a refusal flash past. Everywhere else it defaults to on.
 */
export function useMe(enabled = true): { me: Me | null; loading: boolean; reload: () => void } {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!enabled) return;
    if (!isAuthenticated()) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .me()
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce, enabled]);
  return { me, loading, reload: () => setNonce((n) => n + 1) };
}
