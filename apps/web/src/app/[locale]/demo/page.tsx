"use client";

/**
 * The guided demo: seven scenes, each deep-linking into the real console with the right context.
 *
 * BLACKLIGHT NOTES
 * - The left rail is a stepper, not a list of buttons: seen / active / rest are three distinct
 *   surfaces off the elevation ladder (verdigris wash / brass wash / overlay-1), and each one keeps
 *   its glyph — ✓ for seen, the ordinal otherwise — so progress is never carried by colour alone.
 * - The completed marker used `bg-verdigris text-white`, which is 1.9:1. It is now the verdigris
 *   chip: soft ground, 45% rim, verdigris glyph.
 * - Progress uses the shared Meter rather than a hand-rolled rail, so it tracks the console.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setScenario } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { Button, Card, Chip, cx, Eyebrow, Icon, Meter, PageHeader } from "@/components/ui";
import { IdTag } from "@/components/console";

const SCENES = [
  { id: "onboard", route: "/signup", preset: null },
  { id: "vault", route: "/app/vault", preset: null },
  { id: "normal", route: "/app/access", preset: "trusted" },
  { id: "attack", route: "/app/access", preset: "attacker" },
  { id: "failclosed", route: "/app/access", preset: "trusted", outage: "ledger" as const },
  { id: "replay", route: "/admin/incidents", preset: null },
  { id: "proof", route: "/app/verify", preset: null },
] as const;

const STORAGE_KEY = "vajra_demo_progress";

export default function DemoGuide() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSeen(JSON.parse(raw) as string[]);
    } catch {
      /* first run */
    }
  }, []);

  const markSeen = (id: string) => {
    const next = seen.includes(id) ? seen : [...seen, id];
    setSeen(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const go = async (index: number) => {
    const scene = SCENES[index]!;
    setBusy(true);
    try {
      if (scene.preset) {
        const { presets } = await api.demoPresets();
        const preset = presets[scene.preset];
        if (preset) {
          const { label: _label, ...rest } = preset;
          setScenario(rest);
        }
      } else {
        setScenario(null);
      }
      if ("outage" in scene && scene.outage) {
        await api.demoOutage(scene.outage, true);
        setOutage(true);
      }
      markSeen(scene.id);
      router.push(`/${locale}${scene.route}`);
    } finally {
      setBusy(false);
    }
  };

  const scene = SCENES[active]!;

  return (
    <main className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 px-5 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4">
          <Link href={`/${locale}`} className="group flex items-center gap-2.5 rounded-[var(--radius-control)] text-ink">
            <svg viewBox="0 0 28 28" className="h-5 w-5 text-brass transition-transform duration-200 ease-out-soft group-hover:scale-110" fill="none" aria-hidden>
              <path d="M14 2.5 L20 10 L16.5 10 L21 25.5 L14 17 L7 25.5 L11.5 10 L8 10 Z" fill="currentColor" />
            </svg>
            <span className="font-display text-[1rem] font-semibold tracking-[-0.015em]">{t("brand.name")}</span>
          </Link>
          <span aria-hidden className="h-4 w-px shrink-0 bg-line" />
          <span className="text-[0.8125rem] text-ink-3">{t("demo.title")}</span>
          <div className="ml-auto flex items-center gap-2">
            {outage && (
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await api.demoOutage("ledger", false);
                  await api.demoDrain();
                  setOutage(false);
                }}
              >
                {Icon.warn} {t("dashboard.restore", { dep: t("dashboard.deps.ledger") })}
              </Button>
            )}
            <Link href={`/${locale}/login`}>
              <Button size="sm" variant="primary">
                {t("nav.openApp")} {Icon.arrow}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1100px] px-5 py-12">
        <PageHeader
          title={t("demo.title")}
          subtitle={t("demo.subtitle")}
          actions={
            <>
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.demoReset();
                    setSeen([]);
                    localStorage.removeItem(STORAGE_KEY);
                    setResetDone(true);
                    setTimeout(() => setResetDone(false), 3000);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? t("demo.resetting") : t("demo.resetState")}
              </Button>
              {resetDone && (
                <Chip tone="good" icon={Icon.check} className="stamp">
                  {t("demo.resetDone")}
                </Chip>
              )}
            </>
          }
        />

        <div className="grid gap-8 lg:grid-cols-[300px_1fr] lg:items-start">
          {/* ── The stepper rail ──────────────────────────────────────────── */}
          <nav aria-label={t("demo.title")} className="lg:sticky lg:top-24">
            <div className="mb-4">
              <Meter value={seen.length} max={SCENES.length} tone="good" showValue={false} />
            </div>
            <ol className="space-y-1">
              {SCENES.map((s, i) => {
                const isSeen = seen.includes(s.id);
                const isActive = i === active;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setActive(i)}
                      aria-current={isActive ? "step" : undefined}
                      className={cx(
                        "group flex w-full items-center gap-3 rounded-[var(--radius-control)] border px-3.5 py-2.5 text-left",
                        "transition-[color,background-color,border-color,box-shadow] duration-150 ease-out active:translate-y-px",
                        isActive
                          ? "border-brass-line bg-brass-soft shadow-lift"
                          : "border-line bg-overlay-1 hover:border-line-strong hover:bg-paper-2 active:bg-paper-3",
                      )}
                    >
                      <span
                        className={cx(
                          "tnum grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-pill)] border font-mono text-[0.75rem] leading-none",
                          "transition-[color,background-color,border-color] duration-150 ease-out",
                          isSeen
                            ? "border-verdigris-line bg-verdigris-soft text-verdigris"
                            : isActive
                              ? "border-brass-line bg-brass-soft text-brass-deep"
                              : "border-line text-ink-3 group-hover:border-line-strong group-hover:text-ink-2",
                        )}
                      >
                        {isSeen ? "✓" : i + 1}
                      </span>
                      <span className={cx("text-[0.875rem] leading-snug", isActive ? "font-medium text-ink" : "text-ink-2 group-hover:text-ink")}>
                        {t(`demo.scenes.${s.id}.title`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* ── The scene ─────────────────────────────────────────────────── */}
          <Card className="h-fit px-6 py-6 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Eyebrow>{t("demo.progress", { n: String(active + 1), total: String(SCENES.length) })}</Eyebrow>
              <IdTag title={scene.route}>
                {scene.route}
              </IdTag>
            </div>
            {/* Keyed on the scene so the panel re-enters when the rail moves. */}
            <div key={scene.id} className="auth-panel">
              <h2 className="mt-3 font-display text-[1.5rem] leading-[1.15] tracking-[-0.015em]">{t(`demo.scenes.${scene.id}.title`)}</h2>
              <p className="mt-3.5 text-[0.9375rem] leading-[1.65] text-ink-2">{t(`demo.scenes.${scene.id}.body`)}</p>

              <div className="mt-6 rounded-[var(--radius-field)] border-l-2 border-brass bg-brass-soft/35 px-4 py-3.5">
                <p className="eyebrow mb-1.5">{t("demo.watchFor")}</p>
                <p className="text-[0.875rem] leading-[1.6] text-ink">{t(`demo.scenes.${scene.id}.watch`)}</p>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-line-faint pt-5">
              <Button variant="primary" loading={busy} onClick={() => void go(active)}>
                {t("demo.goTo")} {Icon.arrow}
              </Button>
              <Button variant="ghost" onClick={() => markSeen(scene.id)} disabled={seen.includes(scene.id)}>
                {seen.includes(scene.id) ? <>{Icon.check} {t("demo.done")}</> : t("demo.markDone")}
              </Button>
              <div className="ml-auto flex gap-2">
                <Button size="sm" disabled={active === 0} onClick={() => setActive((a) => Math.max(0, a - 1))}>
                  {t("common.back")}
                </Button>
                <Button size="sm" disabled={active === SCENES.length - 1} onClick={() => setActive((a) => Math.min(SCENES.length - 1, a + 1))}>
                  {t("common.next")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
