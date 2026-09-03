"use client";

/**
 * DEMO_MODE only: sign in as a seeded role.
 *
 * The seeded identities predate the enrolment flow and hold their keys server-side, so they cannot
 * go through the five gates on a presenter's laptop. This keeps the guided demo and the four role
 * walkthroughs reachable, and it disappears entirely when the gateway has DEMO_MODE off — the probe
 * is a real call, not a build flag, so a production deployment simply never renders it.
 *
 * Visually it is deliberately demoted. The old top rule made it look like the second half of the
 * form; it is not part of the form at all, it is a bypass. So it sits in its own recessed well —
 * one overlay step, a faint rim, no shadow — while the real path above keeps the flat ground and
 * the only primary button on the screen.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@vajra/contracts";
import { api, setSession } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { Button } from "@/components/ui";

const DEMO_ROLES: Role[] = ["engineer", "manager", "auditor", "admin"];

export function DemoSignIn() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<Role | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .demoPresets()
      .then(() => alive && setAvailable(true))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  if (!available) return null;

  const signIn = async (role: Role) => {
    setBusy(role);
    try {
      const res = await api.demoLogin(role);
      setSession(res.sessionJwt);
      router.push(`/${locale}/${res.user.role === "admin" ? "admin" : "app"}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    // The probe resolves after paint, so this block always arrives late — it gets the panel entrance
    // rather than appearing out of nothing under the reader's eye.
    <div className="auth-panel mt-8 rounded-[var(--radius-field)] border border-line-faint bg-overlay-1 px-4 py-4">
      <div className="flex items-baseline gap-2">
        <p className="eyebrow">{t("onboard.quickSignIn")}</p>
      </div>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-3">{t("onboard.quickSignInNote")}</p>
      <div className="mt-3.5 grid grid-cols-2 gap-2">
        {DEMO_ROLES.map((r) => (
          <Button key={r} size="sm" className="justify-center" loading={busy === r} disabled={!!busy} onClick={() => void signIn(r)}>
            {t(`roles.${r}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
