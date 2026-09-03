"use client";

/**
 * The public verifier: no session needed — verification uses the document and the ledger only.
 *
 * BLACKLIGHT NOTES
 * - The verdict is the point of the page, so it is a real VerdictStamp at `lg`: 2px rim, a wash of
 *   its own hue, its glyph, and the 200ms strike. The old hand-rolled span carried the rim only.
 * - The paste box is a console well inside an editorial card — the one place on the public site
 *   where machine-made material is entered, so it takes the field radius, the console fill and the
 *   console scrollbar. Its focus:outline-none/ring pair is gone: the global :focus-visible rule is
 *   unlayered and already lays down the brass outline plus its shadow-arc rim.
 * - The resting state is the shared EmptyState rather than a bare centred card.
 */
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { ProofChecks } from "@/components/trust";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Button, Card, Chip, EmptyState, ErrorNote, PageHeader } from "@/components/ui";
import { VerdictStamp } from "@/components/console";

export default function PublicVerify() {
  const { t, locale } = useI18n();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ valid: boolean; checks: { id: string; ok: boolean; detailKey?: string }[]; meta?: string } | null>(null);

  const verify = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ("packageHash" in parsed) {
        const res = await api.verifyEvidence(parsed);
        setResult({ valid: res.valid, checks: res.checks, meta: `${res.packageId} · ${res.events} events · ${res.proofs} proofs` });
      } else {
        const res = await api.verifyProof(parsed);
        setResult({ valid: res.valid, checks: res.checks, meta: String(parsed.certId ?? "") });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
          <span className="text-[0.8125rem] text-ink-3">{t("verify.title")}</span>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher compact />
            <Link href={`/${locale}/login`}>
              <Button size="sm">{t("nav.openApp")}</Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1100px] px-5 py-12">
        <PageHeader title={t("verify.title")} subtitle={t("verify.subtitle")} />

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {/* ── The document ──────────────────────────────────────────────── */}
          <Card className="p-5">
            <textarea
              className="console-scroll h-80 w-full resize-none rounded-[var(--radius-field)] border border-line bg-console px-3.5 py-3 font-mono text-[0.75rem] leading-relaxed text-console-text placeholder:text-console-muted transition-[border-color,background-color] duration-150 ease-out hover:border-line-strong focus:border-brass"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t("verify.placeholder")}
              spellCheck={false}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" loading={busy} disabled={!raw.trim()} onClick={() => void verify()}>
                {busy ? t("verify.verifying") : t("verify.verify")}
              </Button>
              <p className="text-[0.75rem] leading-snug text-ink-3">{t("verify.tryTampering")}</p>
            </div>
          </Card>

          {/* ── The verdict ───────────────────────────────────────────────── */}
          <div className="space-y-4">
            {error && <ErrorNote message={error} />}
            {result && (
              <Card className="p-5 shadow-panel">
                <div className="flex flex-wrap items-center gap-3 border-b border-line-faint pb-5">
                  <VerdictStamp verdict={result.valid ? "ALLOW" : "DENY"} label={result.valid ? t("verify.valid") : t("verify.invalid")} size="lg" />
                  {result.meta && (
                    <Chip tone="neutral" className="tnum font-mono" title={result.meta}>
                      {result.meta}
                    </Chip>
                  )}
                </div>
                <div className="pt-5">
                  <ProofChecks checks={result.checks} />
                </div>
              </Card>
            )}
            {!result && !error && <EmptyState title={t("verify.title")} body={t("landing.proofBody")} />}
          </div>
        </div>
      </div>
    </main>
  );
}
