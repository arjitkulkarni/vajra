"use client";

/**
 * The front door.
 *
 * `/`, `/login` and `/signup` all render this — one designed screen, three entry points, so the
 * first thing anyone sees is the thing they came to do. The two flows live side by side under a
 * sliding tab rather than on separate pages, because "sign in" and "request access" are the same
 * decision made twice and switching between them should not cost a navigation.
 *
 * Layout is a split, and on Blacklight the split is no longer light against dark — both halves are
 * dark now, so the difference is ATMOSPHERE and DEPTH rather than value:
 *
 *   the aside  the console well (#08090B), a full step below the ground, carrying every moving
 *              thing on the screen — drifting aurora, blueprint lattice, grain, the self-drawing
 *              mark, the five-gate rail. It has weather.
 *   the form   the ground (#0E0F11), dead still and dead flat. No texture, no shadow, no card.
 *              Nothing competes with the two inputs and the one button.
 *
 * The seam between them is a single hairline on the aside's edge, because ~6% of luminance is not
 * enough separation on a projector and the boundary has to survive one.
 *
 * Below `lg` the aside drops away, so the form half borrows one faint light source to keep the
 * door from reading as a void — the aside's context is gone, but its presence should not be.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getSession, type Me } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Button, Icon, cx } from "@/components/ui";
import { AuthAside } from "./AuthAside";
import { DemoSignIn } from "./DemoSignIn";
import { LoginFlow } from "./LoginFlow";
import { SignupFlow } from "./SignupFlow";

export type AuthTab = "login" | "signup";
const TABS: AuthTab[] = ["login", "signup"];

export function AuthScreen({ initial = "login" }: { initial?: AuthTab }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<AuthTab>(initial);
  const [me, setMe] = useState<Me | null>(null);

  // Someone arriving with a live session gets an offer, not a redirect — a redirect here would
  // fight anyone who came to this page deliberately to sign in as somebody else.
  useEffect(() => {
    if (!getSession()) return;
    let alive = true;
    api
      .me()
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, []);

  // Keep the URL honest as the tab moves, without a navigation or a re-render of the flows.
  const select = useCallback(
    (next: AuthTab) => {
      setTab(next);
      window.history.replaceState(null, "", `/${locale}/${next}`);
    },
    [locale],
  );

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr] xl:grid-cols-[1.15fr_1fr]">
      <AuthAside />

      {/* `isolate` is load-bearing: without a stacking context the -z-10 glow below would paint
          behind this element's own bg-paper and never be seen at all. */}
      <div className="relative isolate flex flex-col bg-paper">
        <div
          className="auth-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[24rem] opacity-40 lg:hidden"
          aria-hidden
        />

        {/* Header: brand, language, and the way back to the explanation. */}
        <header className="flex items-center gap-4 px-6 py-5 sm:px-10">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-2 rounded-[var(--radius-tag)] text-ink transition-colors duration-150 ease-out hover:text-brass lg:hidden"
          >
            <svg viewBox="0 0 28 28" className="h-5 w-5 text-brass" fill="none" aria-hidden>
              <path d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z" fill="currentColor" />
            </svg>
            <span className="font-display text-[1rem] font-semibold tracking-[-0.015em]">{t("brand.name")}</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href={`/${locale}/about`}
              className="hidden rounded-[var(--radius-tag)] text-[0.8125rem] text-ink-2 transition-colors duration-150 ease-out hover:text-ink sm:inline"
            >
              {t("auth.aboutLink")}
            </Link>
            <LocaleSwitcher compact />
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-12 sm:px-10">
          <div className="w-full max-w-[26rem]">
            <div className="rise" style={{ animationDelay: "60ms" }}>
              <h1 className="font-display text-[2rem] leading-[1.12] tracking-[-0.02em]">{t(`${tab}.title`)}</h1>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-2">{t(`${tab}.subtitle`)}</p>
            </div>

            {me && (
              <div className="auth-panel mt-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-field)] border border-brass-line bg-brass-soft/60 px-4 py-3">
                <p className="text-[0.875rem] text-ink-2">{t("auth.alreadySignedIn", { name: me.user.displayName })}</p>
                <Button
                  size="sm"
                  variant="primary"
                  className="ml-auto"
                  onClick={() => router.push(`/${locale}/${me.user.role === "admin" ? "admin" : "app"}`)}
                >
                  {t("auth.continue")} {Icon.arrow}
                </Button>
              </div>
            )}

            {/* Sliding tab. The indicator is one element that translates, so the motion is a single
                transform rather than two colour fades fighting each other. It is the one surface on
                this screen allowed to OCCLUDE — globals.css pins `.auth-tab-indicator` to
                paper-raised — and shadow-lift's inset white top rim is what separates it from the
                track, because on near-black a cast shadow separates nothing. Its 6px radius is the
                exact inset of the track's 10px less the 4px of padding. */}
            <div className="rise mt-7" style={{ animationDelay: "140ms" }}>
              <div
                role="tablist"
                aria-label={t("auth.tablist")}
                className="relative grid grid-cols-2 rounded-[var(--radius-control)] border border-line bg-paper-2/60 p-1"
              >
                <span
                  aria-hidden
                  className="auth-tab-indicator absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-[var(--radius-panel)] shadow-lift"
                  style={{ transform: `translateX(${TABS.indexOf(tab) * 100}%)` }}
                />
                {TABS.map((id) => (
                  <button
                    key={id}
                    role="tab"
                    type="button"
                    aria-selected={tab === id}
                    onClick={() => select(id)}
                    className={cx(
                      "relative z-10 rounded-[var(--radius-panel)] px-3 py-2 text-[0.875rem] transition-colors duration-150 ease-out",
                      tab === id ? "font-medium text-ink" : "text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {t(`auth.tabs.${id}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Cross-fade on the key, so switching tabs animates instead of snapping. */}
            <div key={tab} className="auth-panel mt-7">
              {tab === "login" ? <LoginFlow /> : <SignupFlow onSwitchToLogin={() => select("login")} />}
            </div>

            {tab === "login" && <DemoSignIn />}

            <p className="rise mt-8 text-center text-[0.8125rem] text-ink-3" style={{ animationDelay: "220ms" }}>
              {tab === "login" ? t("login.noAccount") : t("signup.haveAccount")}{" "}
              <button
                type="button"
                onClick={() => select(tab === "login" ? "signup" : "login")}
                className="rounded-[var(--radius-tag)] font-medium text-brass underline-offset-2 transition-colors duration-150 ease-out hover:text-brass-deep hover:underline"
              >
                {tab === "login" ? t("auth.tabs.signup") : t("auth.tabs.login")}
              </button>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
