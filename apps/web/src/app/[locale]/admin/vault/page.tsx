"use client";

/** Asset registry — everything under custody, filterable, with trust carried on every row. */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass, Sensitivity } from "@vajra/contracts";
import { api, GatewayError } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { useConsoleBase } from "@/lib/nav";
import { useAsync } from "@/components/trust";
import { useEntity } from "@/components/EntityDrawer";
import { DataCell, DataRow, DataTable, DistributionBar, FilterBar, IdTag, OpsHeader, Panel, Segmented, SelectInput, StatBand, StateDot, TextInput } from "@/components/console";
import { Button, Dialog, ErrorNote, Field, Icon, Skeleton, cx, inputClass, toneForTrust } from "@/components/ui";

const CLASSES: AssetClass[] = ["design", "model", "certificate", "document"];
const SENSITIVITIES: Sensitivity[] = ["low", "medium", "high"];

export default function Registry() {
  const { t, locale, dt, n } = useI18n();
  const base = useConsoleBase();
  const router = useRouter();
  const { open } = useEntity();
  const assets = useAsync(() => api.assets(), []);

  const [term, setTerm] = useState("");
  const [klass, setKlass] = useState("");
  const [sensitivity, setSensitivity] = useState("");
  const [scope, setScope] = useState("all");
  const [upload, setUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details?: Record<string, unknown> } | null>(null);
  const [form, setForm] = useState<{ file: File | null; name: string; class: AssetClass; sensitivity: Sensitivity; parentUid: string }>({
    file: null,
    name: "",
    class: "design",
    sensitivity: "high",
    parentUid: "",
  });

  const all = useMemo(() => assets.data ?? [], [assets.data]);
  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    return all.filter((a) => {
      if (klass && a.class !== klass) return false;
      if (sensitivity && a.sensitivity !== sensitivity) return false;
      if (scope === "mine" && !a.owned) return false;
      if (scope === "low" && a.assetTrust >= 70) return false;
      if (!q) return true;
      return [a.assetUid, a.name, a.ownerName].some((f) => f && f.toLowerCase().includes(q));
    });
  }, [all, term, klass, sensitivity, scope]);

  const bands = useMemo(
    () => ({
      healthy: all.filter((a) => a.assetTrust >= 75).length,
      watch: all.filter((a) => a.assetTrust >= 45 && a.assetTrust < 75).length,
      restricted: all.filter((a) => a.assetTrust < 45).length,
      high: all.filter((a) => a.sensitivity === "high").length,
    }),
    [all],
  );

  const submit = async () => {
    if (!form.file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", form.file);
      fd.append("name", form.name.trim() || form.file.name);
      fd.append("class", form.class);
      fd.append("sensitivity", form.sensitivity);
      if (form.parentUid) fd.append("parentUid", form.parentUid);
      const res = await api.uploadAsset(fd);
      setUpload(false);
      setForm({ file: null, name: "", class: "design", sensitivity: "high", parentUid: "" });
      assets.reload();
      router.push(`${base}/assets/${encodeURIComponent(res.assetUid)}`);
    } catch (e) {
      const err = e as GatewayError;
      setError({ message: err.message, details: err.code === "duplicate_content" ? (err.details as Record<string, unknown>) : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <OpsHeader
        title={t("console.registry.title")}
        meta={<span>{t("console.registry.subtitle")}</span>}
        actions={
          <Button size="sm" variant="primary" onClick={() => setUpload(true)}>
            {t("vault.upload")}
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        <StatBand
          items={[
            { label: t("console.registry.title"), value: n(all.length) },
            { label: t("sensitivity.high"), value: n(bands.high), tone: bands.high > 0 ? "warn" : "neutral" },
            { label: t("console.overview.healthy"), value: n(bands.healthy), tone: "good" },
            { label: t("console.overview.restricted"), value: n(bands.restricted), tone: bands.restricted > 0 ? "bad" : "neutral" },
          ]}
        />
        <Panel title={t("console.overview.trustDistribution")}>
          <DistributionBar
            segments={[
              { key: "healthy", value: bands.healthy, tone: "good", label: t("console.overview.healthy") },
              { key: "watch", value: bands.watch, tone: "warn", label: t("console.overview.watch") },
              { key: "restricted", value: bands.restricted, tone: "bad", label: t("console.overview.restricted") },
            ]}
          />
        </Panel>
      </div>

      <FilterBar className="mb-3">
        <TextInput className="min-w-[200px]" label={t("console.audit.searchPlaceholder")} value={term} onChange={setTerm} placeholder="AST-…" mono />
        <SelectInput
          label={t("console.registry.filterClass")}
          value={klass}
          onChange={setKlass}
          options={[{ value: "", label: t("common.all") }, ...CLASSES.map((c) => ({ value: c, label: t(`assetClass.${c}`) }))]}
        />
        <SelectInput
          label={t("console.registry.filterSensitivity")}
          value={sensitivity}
          onChange={setSensitivity}
          options={[{ value: "", label: t("common.all") }, ...SENSITIVITIES.map((s) => ({ value: s, label: t(`sensitivity.${s}`) }))]}
        />
        <Segmented
          label={t("console.registry.filterTrust")}
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: t("console.registry.trustAll") },
            { value: "mine", label: t("console.registry.mine") },
            { value: "low", label: t("console.registry.trustLow") },
          ]}
        />
      </FilterBar>

      {assets.error && <ErrorNote message={assets.error} onRetry={assets.reload} retryLabel={t("common.retry")} />}

      <Panel title={t("console.registry.title")} meta={`${n(rows.length)} / ${n(all.length)}`} flush>
        {assets.loading && !assets.data ? (
          <Skeleton className="h-64" />
        ) : rows.length === 0 ? (
          <p className="px-3 py-12 text-center text-[0.8125rem] text-ink-3">{t("console.registry.empty")}</p>
        ) : (
          <DataTable
            minWidth={940}
            cols={[
              t("console.registry.cols.asset"),
              t("console.registry.cols.class"),
              t("console.registry.cols.sensitivity"),
              t("console.registry.cols.owner"),
              { label: t("console.registry.cols.version"), align: "right" },
              { label: t("console.registry.cols.trust"), align: "right", width: "90px" },
              t("console.registry.cols.updated"),
            ]}
          >
            {rows.map((a) => {
              const tone = toneForTrust(a.assetTrust);
              return (
                <DataRow key={a.assetUid} onClick={() => router.push(`${base}/assets/${encodeURIComponent(a.assetUid)}`)} tone={a.assetTrust < 45 ? "bad" : undefined}>
                  <DataCell strong>
                    <span className="flex flex-wrap items-center gap-2">
                      {a.name}
                      {/* The uid opens the entity drawer; the row opens the passport. Two targets,
                          so the inner one is a real button — reachable, pressable, and it brightens
                          toward the accent because opening the drawer is agency, not a state. */}
                      <button
                        type="button"
                        className="group rounded-[var(--radius-tag)] active:translate-y-px"
                        onClick={(e) => {
                          e.stopPropagation();
                          open({ kind: "asset", id: a.assetUid });
                        }}
                      >
                        <IdTag tone="neutral" className="transition-[color,border-color] duration-150 ease-out group-hover:border-brass-line group-hover:text-brass-deep">
                          {a.assetUid}
                        </IdTag>
                      </button>
                      {a.owned && <IdTag tone="steel">{t("vault.yours")}</IdTag>}
                    </span>
                  </DataCell>
                  <DataCell>{t(`assetClass.${a.class}`)}</DataCell>
                  <DataCell>
                    <span className={cx("text-[0.75rem] font-medium uppercase tracking-[0.06em]", a.sensitivity === "high" ? "text-oxide" : a.sensitivity === "medium" ? "text-saffron" : "text-ink-3")}>
                      {t(`sensitivity.${a.sensitivity}`)}
                    </span>
                  </DataCell>
                  <DataCell>{a.ownerName ?? a.ownerDid.slice(0, 16)}</DataCell>
                  <DataCell mono align="right">
                    v{n(a.currentVersion)}
                  </DataCell>
                  <DataCell mono align="right">
                    {/* The score carries a disc as well as a hue — a bare number in a colour is the
                        one state in this table an operator reads at a glance from across a desk. */}
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <StateDot tone={tone} />
                      <span className={cx("tnum", tone === "good" ? "text-verdigris" : tone === "warn" ? "text-saffron" : "text-oxide")}>{n(a.assetTrust)}</span>
                    </span>
                  </DataCell>
                  <DataCell mono nowrap>
                    {dt(a.createdAt, { dateStyle: "short", timeStyle: "short" })}
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Dialog open={upload} onClose={() => setUpload(false)} title={t("vault.uploadTitle")}>
        <p className="mb-5 text-[0.875rem] leading-relaxed text-ink-2">{t("vault.uploadBody")}</p>
        <div className="space-y-4">
          <Field label={t("vault.file")}>
            {/* A dropzone sits in the field register (12px) and reads as a well: dashed hairline
                over an overlay wash, brightening toward the accent on hover. */}
            <input
              type="file"
              className={cx(
                "block w-full cursor-pointer rounded-[var(--radius-field)] border border-dashed border-line-strong bg-overlay-1 px-3 py-3 text-[0.8125rem] text-ink-3",
                "transition-[color,background-color,border-color] duration-150 ease-out hover:border-brass-line hover:bg-overlay-2 hover:text-ink-2",
                "file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-paper-3 file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium file:text-ink",
                "file:transition-[background-color] file:duration-150 hover:file:bg-paper-raised",
              )}
              onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null, name: f.name || (e.target.files?.[0]?.name ?? "") }))}
            />
          </Field>
          <Field label={t("vault.name")}>
            <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("vault.class")}>
              <select className={inputClass} value={form.class} onChange={(e) => setForm((f) => ({ ...f, class: e.target.value as AssetClass }))}>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {t(`assetClass.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("vault.sensitivityLabel")}>
              <select className={inputClass} value={form.sensitivity} onChange={(e) => setForm((f) => ({ ...f, sensitivity: e.target.value as Sensitivity }))}>
                {SENSITIVITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sensitivity.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t("vault.parent")} hint={t("vault.parentHint")}>
            <select className={inputClass} value={form.parentUid} onChange={(e) => setForm((f) => ({ ...f, parentUid: e.target.value }))}>
              <option value="">{t("vault.parentNone")}</option>
              {all.map((a) => (
                <option key={a.assetUid} value={a.assetUid}>
                  {a.name} ({a.assetUid})
                </option>
              ))}
            </select>
          </Field>

          {error && (
            <div role="alert" className="rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-4 py-3">
              <p className="flex items-start gap-2 text-[0.875rem] font-medium text-oxide">
                <span className="shrink-0 leading-[1.45]">{Icon.warn}</span>
                {error.details ? t("vault.duplicateTitle") : error.message}
              </p>
              {error.details && (
                <p className="mt-1 pl-6 text-[0.8125rem] leading-relaxed text-oxide">
                  {t("vault.duplicateBody", {
                    assetUid: String(error.details.assetUid),
                    version: n(Number(error.details.version)),
                    sensitivity: t(`sensitivity.${String(error.details.sensitivity)}`),
                  })}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUpload(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} disabled={!form.file} onClick={() => void submit()}>
              {busy ? t("vault.minting") : t("vault.submit")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
