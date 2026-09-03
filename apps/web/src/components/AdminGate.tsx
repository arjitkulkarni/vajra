"use client";

/**
 * The door to the control plane.
 *
 * This is a *courtesy* gate, not the security boundary — every administrator-only endpoint behind
 * it re-checks the role on the server with `requireRole(session, "admin")`, because a client that
 * hides a button has not actually refused anything. What this buys is that someone who is signed in
 * as an engineer is told plainly where they belong instead of watching six panels fail to load.
 *
 * Styling note: the two refusals keep different hues because they are different conditions. The
 * network gate is a step-up requirement — come back from the right place — so it reads saffron.
 * The role gate is a fact about who you are, so it reads steel. Neither borrows oxide: DENY is the
 * decision engine's word, and a courtesy gate must not impersonate a policy verdict.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, useMe } from "@/components/AppShell";
import { CONSOLE_KEY_PARAM, isAuthenticated, setConsoleKey } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { Button, Card, Icon, PageHeader, Spinner } from "@/components/ui";

/** The refusal card. One shape, two tones, so the two doors read as siblings rather than as bugs. */
function GateCard({
  tone,
  glyph,
  body,
  hint,
  action,
}: {
  tone: "steel" | "saffron";
  glyph: React.ReactNode;
  body: string;
  hint?: string;
  action: React.ReactNode;
}) {
  const badge =
    tone === "steel" ? "border-steel-line bg-steel-soft text-steel" : "border-saffron-line bg-saffron-soft text-saffron";
  return (
    <Card className="rise max-w-lg overflow-hidden">
      <div className="flex items-start gap-3.5 px-6 py-6">
        <span
          aria-hidden
          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border text-[0.75rem] ${badge}`}
        >
          {glyph}
        </span>
        <div className="min-w-0">
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">{body}</p>
          {hint && (
            <p className="mt-3.5 rounded-[var(--radius-field)] border border-line-faint bg-overlay-1 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink-3">
              {hint}
            </p>
          )}
        </div>
      </div>
      <div className="border-t border-line-faint bg-overlay-1 px-6 py-3.5">{action}</div>
    </Card>
  );
}

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const router = useRouter();

  /**
   * Take the console key out of the URL before anything else runs.
   *
   * `window.location.search` read in an effect, not `useSearchParams()` — the console's routes stay
   * statically prerenderable, which is the house rule. The key is banked in sessionStorage and then
   * scrubbed from the address bar with `replaceState`, so it survives navigation inside the tab but
   * does not survive a screenshot, a bookmark, or someone reading over a shoulder.
   *
   * `captured` gates the first render: without it the page would ask `/v1/me` before the key was
   * stored, get a truthful `adminConsole: false`, and flash the refusal card at an operator who
   * followed the correct link.
   */
  const [captured, setCaptured] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(CONSOLE_KEY_PARAM);
    if (fromUrl) {
      setConsoleKey(fromUrl);
      url.searchParams.delete(CONSOLE_KEY_PARAM);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setCaptured(true);
  }, []);

  const { me, loading } = useMe(captured);

  /**
   * `isAuthenticated`, not `getSession()`.
   *
   * The issued console link never mints a session cookie — it authenticates on its own, on every
   * request (see the gateway's modules/identity/console-session.ts). Asking only about the cookie
   * meant an operator who followed the correct link was bounced straight to /login while the
   * gateway was perfectly willing to serve them, which is the one failure this door exists to
   * prevent rather than cause.
   *
   * Gated on `captured` because the key is banked from the URL in the effect above: before that
   * commits, sessionStorage is genuinely empty and the honest answer to "are we authenticated" is
   * "not yet".
   */
  const signedOut = captured && !isAuthenticated();

  useEffect(() => {
    if (signedOut) router.replace(`/${locale}/login`);
  }, [signedOut, locale, router]);

  if (!captured || signedOut || (loading && !me)) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <Spinner className="text-ink-3" />
      </div>
    );
  }

  const toWorkspace = (
    <Link href={`/${locale}/app`} className="inline-block">
      <Button variant="primary">
        {t("admin.gate.toWorkspace")} {Icon.arrow}
      </Button>
    </Link>
  );

  /*
   * A session cookie the gateway will not honour is not a session.
   *
   * This guard is load-bearing and its absence was a real hole: the three refusals below are each
   * written `me && …`, so a null `me` — an expired or revoked session, where `getSession()` still
   * finds a stale cookie and so the redirect above never fires — skipped all three and rendered the
   * console. What the operator then saw was the full control plane with every panel empty, a
   * "Verify identity" button in the header and identity trust 0: an admin console that appeared to
   * be reporting that nothing exists, when it was in fact reporting that nobody was signed in.
   *
   * The gateway was never fooled — every call behind this was 401ing correctly. Only the UI lied.
   */
  if (!me) {
    return (
      <AppShell variant="workspace">
        <PageHeader title={t("admin.gate.title")} subtitle={t("admin.gate.sessionSubtitle")} />
        <GateCard
          tone="saffron"
          glyph={Icon.lock}
          body={t("admin.gate.sessionBody")}
          action={
            <Link href={`/${locale}/login`} className="inline-block">
              <Button variant="primary">
                {t("app.signIn")} {Icon.arrow}
              </Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  // Three different refusals, said differently. Conflating them would leave an administrator on the
  // wrong network staring at a message about their role, with nothing to act on.
  //
  // The console key is checked first because it is the outermost door and the least about the
  // person: someone without the link should be told they need the link, not shown a remark about
  // their account. The gateway refuses in the same order for the same reason.
  if (me && !me.adminConsole) {
    return (
      <AppShell variant="workspace">
        <PageHeader title={t("admin.gate.title")} subtitle={t("admin.gate.consoleSubtitle")} />
        <GateCard
          tone="steel"
          glyph={Icon.lock}
          body={t("admin.gate.consoleBody")}
          hint={t("admin.gate.consoleHint")}
          action={toWorkspace}
        />
      </AppShell>
    );
  }

  if (me && !me.adminNetwork) {
    return (
      <AppShell variant="workspace">
        <PageHeader title={t("admin.gate.title")} subtitle={t("admin.gate.networkSubtitle")} />
        <GateCard
          tone="saffron"
          glyph={Icon.lock}
          body={t("admin.gate.networkBody")}
          hint={t("admin.gate.networkHint")}
          action={toWorkspace}
        />
      </AppShell>
    );
  }

  if (me && me.user.role !== "admin") {
    return (
      <AppShell variant="workspace">
        <PageHeader title={t("admin.gate.title")} subtitle={t("admin.gate.subtitle")} />
        <GateCard
          tone="steel"
          glyph={Icon.shield}
          body={t("admin.gate.body", { role: t(`roles.${me.user.role}`) })}
          action={toWorkspace}
        />
      </AppShell>
    );
  }

  return <AppShell variant="admin">{children}</AppShell>;
}
