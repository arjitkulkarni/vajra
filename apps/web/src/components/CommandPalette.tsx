"use client";

/**
 * ⌘K / Ctrl-K — the fastest path to any record in VAJRA.
 *
 * Every object in the system carries a stable identifier (AST-…, INC-…, POL-…, PoA-…, did:key:…),
 * so the palette is deliberately ID-first: paste an identifier from a ticket or a log line and land
 * on the record. Names, pages and a short list of verbs are searched too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getSession, type AssetSummary, type IdentityRow, type IncidentSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { linkable, useConsoleArea, useConsoleBase } from "@/lib/nav";
import { useEntity, type EntityRef } from "./EntityDrawer";
import { IdTag, Kbd, StateDot } from "./console";
import { cx, Spinner, type Tone } from "./ui";
import type { PolicyVersion } from "@vajra/contracts";

interface Hit {
  id: string;
  group: string;
  label: string;
  detail?: string;
  badge?: string;
  tone?: Tone;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const area = useConsoleArea();
  const base = useConsoleBase();
  const { open: openEntity } = useEntity();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState<{ assets: AssetSummary[]; people: IdentityRow[]; incidents: IncidentSummary[]; policies: PolicyVersion[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The index is small and refreshes each time the palette opens, so it never goes stale mid-session.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
    if (!getSession()) return;
    let alive = true;
    setLoading(true);
    void Promise.all([
      api.assets().catch(() => [] as AssetSummary[]),
      api.identities().catch(() => [] as IdentityRow[]),
      api.incidents().catch(() => [] as IncidentSummary[]),
      api.policies().catch(() => [] as PolicyVersion[]),
    ])
      .then(([assets, people, incidents, policies]) => alive && setIndex({ assets, people, incidents, policies }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  const go = useCallback(
    (path: string) => {
      onOpenChange(false);
      router.push(`${base}${path}`);
    },
    [base, onOpenChange, router],
  );

  const show = useCallback(
    (ref: EntityRef) => {
      onOpenChange(false);
      openEntity(ref);
    },
    [onOpenChange, openEntity],
  );

  const pages = useMemo(
    () =>
      (
        [
          ["overview", ""],
          ["activity", "/activity"],
          ["incidents", "/incidents"],
          ["requests", "/access"],
          ["approvals", "/approvals"],
          ["policies", "/policies"],
          ["registry", "/vault"],
          ["people", "/identities"],
          ["devices", "/devices"],
          ["audit", "/audit"],
          ["proofs", "/verify"],
          ["timetravel", "/timetravel"],
          ["health", "/system"],
          ["settings", "/settings"],
        ] as const
      ).flatMap(([key, path]) => (linkable(area, path) ? [{ key, path, label: t(`console.shell.items.${key}`) }] : [])),
    [area, t],
  );

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: (string | null | undefined)[]) => !q || fields.some((f) => f && f.toLowerCase().includes(q));
    const out: Hit[] = [];

    for (const a of index?.assets ?? []) {
      if (!match(a.assetUid, a.name, a.class, a.ownerName)) continue;
      out.push({
        id: `asset:${a.assetUid}`,
        group: t("console.palette.groups.assets"),
        label: a.name,
        detail: `${a.assetUid} · v${a.currentVersion} · ${t(`sensitivity.${a.sensitivity}`)}`,
        badge: String(a.assetTrust),
        tone: a.assetTrust >= 75 ? "good" : a.assetTrust >= 45 ? "warn" : "bad",
        run: () => show({ kind: "asset", id: a.assetUid }),
      });
    }
    for (const p of index?.people ?? []) {
      if (!match(p.displayName, p.did, p.role)) continue;
      out.push({
        id: `person:${p.did}`,
        group: t("console.palette.groups.people"),
        label: p.displayName,
        detail: `${t(`roles.${p.role}`)} · ${p.did.slice(0, 22)}…`,
        badge: String(p.identityTrust),
        tone: p.status !== "active" ? "bad" : p.identityTrust >= 75 ? "good" : "warn",
        run: () => show({ kind: "person", id: p.did }),
      });
    }
    for (const i of index?.incidents ?? []) {
      if (!match(i.incidentId, i.summary, i.severity, i.status)) continue;
      out.push({
        id: `incident:${i.incidentId}`,
        group: t("console.palette.groups.incidents"),
        label: i.incidentId,
        detail: i.summary,
        badge: i.severity,
        tone: i.status === "open" ? "bad" : "neutral",
        run: () => show({ kind: "incident", id: i.incidentId }),
      });
    }
    for (const p of index?.policies ?? []) {
      if (!match(p.key, p.spec.name, p.spec.action)) continue;
      out.push({
        id: `policy:${p.id}`,
        group: t("console.palette.groups.policies"),
        label: `${p.key} v${p.version}`,
        detail: p.spec.name,
        badge: p.activeTo ? undefined : t("console.policy.active"),
        tone: p.activeTo ? "neutral" : "good",
        run: () => show({ kind: "policy", id: p.id }),
      });
    }
    for (const page of pages) {
      if (!match(page.label, page.key)) continue;
      out.push({ id: `page:${page.key}`, group: t("console.palette.groups.pages"), label: page.label, run: () => go(page.path) });
    }

    const verbs: [string, string][] = [
      [t("console.palette.actions.requestAccess"), "/access"],
      [t("console.palette.actions.reviewApprovals"), "/approvals"],
      [t("console.palette.actions.verifyProof"), "/verify"],
      [t("console.palette.actions.searchAudit"), "/audit"],
      [t("console.palette.actions.reconstruct"), "/timetravel"],
    ];
    for (const [label, path] of verbs) {
      if (!match(label) || !linkable(area, path)) continue;
      out.push({ id: `action:${path}`, group: t("console.palette.groups.actions"), label, run: () => go(path) });
    }

    return out.slice(0, 40);
  }, [area, index, pages, query, go, show, t]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onOpenChange(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, hits.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        hits[cursor]?.run();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hits, cursor, onOpenChange]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-scrim px-4 pt-[10vh] backdrop-blur-[6px]" onClick={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("console.shell.searchHint")}
        onClick={(e) => e.stopPropagation()}
        className="stamp flex max-h-[70vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[var(--radius-card)] bg-paper-raised shadow-float"
      >
        <div className="group flex items-center gap-2.5 border-b border-line px-3.5 py-3">
          <span aria-hidden className="font-mono text-[0.875rem] text-ink-3 transition-colors duration-150 ease-out group-focus-within:text-brass">
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("console.palette.placeholder")}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink placeholder:text-ink-3 focus:outline-none"
          />
          {loading && <Spinner className="text-ink-3" />}
          <Kbd>esc</Kbd>
        </div>

        <ul ref={listRef} className="console-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {hits.length === 0 && (
            <li className="mx-1 my-3 rounded-[var(--radius-field)] border border-dashed border-line-strong px-4 py-9 text-center text-[0.875rem] text-ink-3">
              {query ? t("console.palette.empty") : t("console.palette.hint")}
            </li>
          )}
          {hits.map((hit, i) => {
            const header = hit.group !== lastGroup ? hit.group : null;
            lastGroup = hit.group;
            const active = i === cursor;
            return (
              <li key={hit.id}>
                {header && <p className={cx("eyebrow px-2 pb-1.5", i === 0 ? "pt-1.5" : "mt-2 border-t border-line-faint pt-3")}>{header}</p>}
                <button
                  type="button"
                  data-active={active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={hit.run}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-[background-color,box-shadow,color] duration-150 ease-out active:translate-y-px",
                    active ? "bg-brass-soft shadow-[inset_0_0_0_1px_var(--color-brass-line)]" : "hover:bg-paper-2",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] text-ink">{hit.label}</span>
                    {hit.detail && <span className={cx("block truncate font-mono text-[0.75rem]", active ? "text-ink-2" : "text-ink-3")}>{hit.detail}</span>}
                  </span>
                  {hit.badge && (
                    <IdTag tone={hit.tone ?? "neutral"}>
                      {hit.tone && hit.tone !== "neutral" && <StateDot tone={hit.tone} />}
                      {hit.badge}
                    </IdTag>
                  )}
                  <span aria-hidden className={cx("hidden shrink-0 transition-opacity duration-150 ease-out sm:block", active ? "opacity-100" : "opacity-0")}>
                    <Kbd>↵</Kbd>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="flex items-center gap-3 border-t border-line bg-overlay-1 px-3.5 py-2 text-[0.6875rem] text-ink-3">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t("console.palette.openHint")}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>esc</Kbd> {t("console.palette.closeHint")}
          </span>
        </footer>
      </div>
    </div>
  );
}
