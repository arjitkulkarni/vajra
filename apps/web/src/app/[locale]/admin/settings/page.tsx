"use client";

import { useEffect, useState } from "react";
import { api, getScenario, setScenario } from "@/lib/api";
import { clearIdentity, loadIdentity } from "@/lib/did";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/components/AppShell";
import { TrustDecayChart, useAsync } from "@/components/trust";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { OpsHeader, Panel } from "@/components/console";
import { Button, Chip, ErrorNote, Field, HashValue, Icon, inputClass } from "@/components/ui";

export default function Settings() {
  const { t, dt } = useI18n();
  const { me } = useMe();
  // Both loads used to fall back to an empty shape, which rendered as "there are no presets" and
  // "this identity has no trust history" — two findings neither call was in a position to make.
  const presets = useAsync(() => api.demoPresets(), []);
  const trust = useAsync(() => api.myTrust(), []);
  const [presetKey, setPresetKey] = useState("");
  const [did, setDid] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    void loadIdentity().then((i) => setDid(i?.did ?? null));
    const s = getScenario();
    if (s) setPresetKey("custom");
  }, []);

  const apply = (key: string) => {
    setPresetKey(key);
    if (!key || !presets.data) return setScenario(null);
    const preset = presets.data.presets[key];
    if (!preset) return setScenario(null);
    const { label: _label, ...scenario } = preset;
    setScenario(scenario);
  };

  return (
    <>
      <OpsHeader title={t("settings.title")} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("settings.language")}>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t("settings.languageBody")}</p>
          <div className="mt-3">
            <LocaleSwitcher />
          </div>
        </Panel>

        <Panel title={t("settings.scenario")}>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t("settings.scenarioBody")}</p>
          <div className="mt-3">
            <Field label={t("access.scenario")}>
              <select className={inputClass} value={presetKey} onChange={(e) => apply(e.target.value)} disabled={Boolean(presets.error)}>
                <option value="">{t("common.none")}</option>
                {Object.entries(presets.data?.presets ?? {}).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {/* A select holding only "None" is indistinguishable from a catalogue with nothing in it. */}
          {presets.error && (
            <div className="mt-3">
              <ErrorNote message={presets.error} onRetry={presets.reload} retryLabel={t("common.retry")} />
            </div>
          )}
        </Panel>

        <Panel title={t("settings.session")}>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t("settings.sessionBody")}</p>
          <div className="mt-3 space-y-2 text-[0.875rem]">
            {me ? (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span>{t("app.signedInAs", { name: me.user.displayName })}</span>
                  <Chip tone="steel">{t(`roles.${me.user.role}`)}</Chip>
                </p>
                <HashValue value={me.user.did} chars={12} />
                <p className="tnum font-mono text-[0.75rem] text-ink-3">{dt(me.user.createdAt)}</p>
              </>
            ) : (
              <p className="text-ink-3">{t("app.notSignedIn")}</p>
            )}
            {did && (
              <div className="border-t border-line-faint pt-3">
                <p className="eyebrow mb-1.5">{t("onboard.yourDid")}</p>
                <HashValue value={did} chars={12} />
                <Button
                  className="mt-2"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void clearIdentity().then(() => setDid(null));
                  }}
                >
                  {t("common.reset")}
                </Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel title={t("demo.resetState")}>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t("demo.resetStateHint")}</p>
          <Button
            className="mt-3"
            loading={resetting}
            onClick={async () => {
              setResetting(true);
              try {
                await api.demoReset();
                setResetDone(true);
              } finally {
                setResetting(false);
              }
            }}
          >
            {resetting ? t("demo.resetting") : t("demo.resetState")}
          </Button>
          {resetDone && (
            <p className="stamp mt-2.5 flex items-center gap-1.5 text-[0.8125rem] font-medium text-verdigris">
              {Icon.check} {t("demo.resetDone")}
            </p>
          )}
        </Panel>
      </div>

      {/*
       * The chart is deliberately absent when there is too little history to draw a curve. A failed
       * load looks identical from the outside, so it takes the panel and says what happened instead.
       */}
      {(trust.error || (trust.data && trust.data.identity.length > 1)) && (
        <Panel className="mt-4" title={t("trust.decay")}>
          {trust.error ? (
            <ErrorNote message={trust.error} onRetry={trust.reload} retryLabel={t("common.retry")} />
          ) : (
            trust.data && <TrustDecayChart events={trust.data.identity} />
          )}
        </Panel>
      )}
    </>
  );
}
