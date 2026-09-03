"use client";

/**
 * The universal entity drawer.
 *
 * Investigations move sideways: an audit event names an actor, the actor has devices, the device
 * touched an asset, the asset belongs to an incident. Navigating away each time loses the thread,
 * so every reference in the console opens here instead — a right-hand panel over the page you
 * were already reading, with a single link out if you do want to leave.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, type AuditEvent, type IdentityRow, type Passport } from "@/lib/api";
import { useI18n } from "@/lib/i18n-client";
import { linkable, useConsoleArea, useConsoleBase } from "@/lib/nav";
import { useAsync } from "@/components/trust";
import { Drawer, IdTag, KeyValues, Panel, StateDot, VerdictStamp, TrustHistoryChart, FactorBreakdown } from "@/components/console";
import { Chip, cx, HashValue, Skeleton, toneForRisk, toneForTrust, type Tone } from "@/components/ui";

export type EntityRef =
  | { kind: "asset"; id: string }
  | { kind: "person"; id: string }
  | { kind: "device"; id: string; ownerDid?: string }
  | { kind: "event"; id: string }
  | { kind: "policy"; id: string }
  | { kind: "incident"; id: string };

interface EntityContextValue {
  open: (ref: EntityRef) => void;
  close: () => void;
  current: EntityRef | null;
}

const EntityContext = createContext<EntityContextValue | null>(null);

export function useEntity(): EntityContextValue {
  const ctx = useContext(EntityContext);
  // Pages outside the console shell simply get a no-op, rather than crashing.
  return ctx ?? { open: () => {}, close: () => {}, current: null };
}

export function EntityProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<EntityRef | null>(null);
  const value = useMemo<EntityContextValue>(
    () => ({ current, open: (ref) => setCurrent(ref), close: () => setCurrent(null) }),
    [current],
  );
  return (
    <EntityContext.Provider value={value}>
      {children}
      <EntityDrawer />
    </EntityContext.Provider>
  );
}

/** A clickable reference. Looks like text, opens the drawer. */
export function EntityLink({ refTo, children, className, mono = true }: { refTo: EntityRef; children: ReactNode; className?: string; mono?: boolean }) {
  const { open } = useEntity();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(refTo);
      }}
      className={`inline-flex max-w-full items-center truncate rounded-[var(--radius-tag)] text-left underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-[color,text-decoration-color] duration-150 ease-out hover:text-brass hover:decoration-brass ${mono ? "font-mono text-[0.75rem]" : ""} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** A failed fetch inside the drawer. Colour is never the only carrier — the glyph rides with it. */
function DrawerError({ message }: { message: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-field)] border border-oxide-line bg-oxide-soft px-3 py-2.5 text-[0.8125rem] text-oxide">
      <span aria-hidden className="leading-[1.45]">
        ✗
      </span>
      <span className="min-w-0 flex-1">{message}</span>
    </p>
  );
}

/** Nothing to show. Dashed hairline, so an empty panel never reads as a loading one. */
function DrawerEmpty({ message }: { message: ReactNode }) {
  return <p className="rounded-[var(--radius-field)] border border-dashed border-line-strong px-3 py-7 text-center text-[0.8125rem] text-ink-3">{message}</p>;
}

/** The subject of the drawer: display face, one rung under the drawer title, never 700. */
function EntityHeading({ children }: { children: ReactNode }) {
  return <span className="font-display text-base font-semibold tracking-[-0.015em] text-ink">{children}</span>;
}

function EntityDrawer() {
  const { current, close } = useEntity();
  const { t } = useI18n();
  const kindLabel = current ? t(`console.entity.${current.kind === "device" ? "device" : current.kind}`) : "";
  return (
    <Drawer
      open={!!current}
      onClose={close}
      closeLabel={t("common.close")}
      title={current ? current.id : ""}
      subtitle={kindLabel}
      width={440}
    >
      {current?.kind === "asset" && <AssetBody uid={current.id} />}
      {current?.kind === "person" && <PersonBody did={current.id} />}
      {current?.kind === "device" && <DeviceBody deviceId={current.id} />}
      {current?.kind === "event" && <EventBody id={current.id} />}
      {current?.kind === "policy" && <PolicyBody id={current.id} />}
      {current?.kind === "incident" && <IncidentBody id={current.id} />}
    </Drawer>
  );
}

/**
 * "Open in full" resolves against whichever console the reader is in, and disappears entirely in
 * the workspace when the destination is an administrator-only page — an investigation can still
 * move sideways through the drawer, it just cannot dead-end on a 404.
 */
function OpenFull({ path }: { path: string }) {
  const { t } = useI18n();
  const { close } = useEntity();
  const area = useConsoleArea();
  const base = useConsoleBase();
  if (!linkable(area, path)) return null;
  return (
    <Link
      href={`${base}${path}`}
      onClick={close}
      className="mt-6 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-brass-line bg-brass-soft/50 px-2.5 py-1.5 text-[0.8125rem] font-medium text-brass transition-[color,background-color,border-color] duration-150 ease-out hover:bg-brass-soft hover:text-brass-deep active:translate-y-px"
    >
      {t("console.entity.viewFull")}
      <span aria-hidden>→</span>
    </Link>
  );
}

// ─── Asset ───────────────────────────────────────────────────────────────────

function AssetBody({ uid }: { uid: string }) {
  const { t, locale, dt, n } = useI18n();
  const passport = useAsync(() => api.passport(uid), [uid]);
  if (passport.loading && !passport.data) return <Skeleton className="h-64" />;
  if (!passport.data) return <DrawerError message={passport.error} />;
  const p: Passport = passport.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <EntityHeading>{p.name}</EntityHeading>
        <Chip tone={p.sensitivity === "high" ? "bad" : p.sensitivity === "medium" ? "warn" : "neutral"}>{t(`sensitivity.${p.sensitivity}`)}</Chip>
        <Chip tone={toneForTrust(p.trust.score)}>
          {t("trust.asset")} {n(p.trust.score)}
        </Chip>
      </div>

      <KeyValues
        items={[
          { k: t("passport.owner"), v: p.owner.displayName ?? "—" },
          { k: t("passport.currentVersion"), v: `v${n(p.currentVersion)}`, mono: true },
          { k: t("vault.columns.class"), v: t(`assetClass.${p.class}`) },
          { k: t("passport.created"), v: dt(p.createdAt, { dateStyle: "medium", timeStyle: "short" }), mono: true },
          { k: t("passport.accessEvents"), v: n(p.stats.accessEvents), mono: true },
          { k: t("passport.incidents"), v: n(p.stats.incidents30d), mono: true },
        ]}
      />

      <Panel title={t("console.why.assetTrust")}>
        <FactorBreakdown
          n={n}
          factors={p.trust.breakdown.map((b) => ({ key: b.key, label: t(`trust.components.${b.key}`), points: b.points, max: b.max }))}
        />
      </Panel>

      <div className="flex flex-wrap gap-2">
        {(["origin", "ownership", "integrity"] as const).map((key) => {
          const ok = key === "origin" ? p.verification.origin : key === "ownership" ? p.verification.ownership : p.verification.integrity;
          return (
            <Chip key={key} tone={ok ? "good" : "warn"}>
              {ok ? "✓" : "⚠"} {t(`passport.${key}`)}
            </Chip>
          );
        })}
      </div>

      <OpenFull path={`/assets/${encodeURIComponent(p.assetUid)}`} />
    </div>
  );
}

// ─── Person ──────────────────────────────────────────────────────────────────

function PersonBody({ did }: { did: string }) {
  const { t, locale, dt, time, n } = useI18n();
  const identities = useAsync(() => api.identities(), []);
  const events = useAsync(() => api.audit({ actorDid: did, limit: 12 }).catch(() => []), [did]);
  if (identities.loading && !identities.data) return <Skeleton className="h-64" />;
  const person = (identities.data ?? []).find((i: IdentityRow) => i.did === did);
  if (!person) return <DrawerEmpty message={t("common.empty")} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <EntityHeading>{person.displayName}</EntityHeading>
        <Chip tone="steel">{t(`roles.${person.role}`)}</Chip>
        <Chip tone={person.status === "active" ? "good" : "bad"}>{t(`identities.status${person.status === "active" ? "Active" : "Revoked"}`)}</Chip>
      </div>

      <KeyValues
        items={[
          { k: t("trust.identity"), v: n(person.identityTrust), mono: true },
          { k: t("console.identity.credential"), v: person.credential ? person.credential.status : "—" },
          { k: t("console.identity.devices"), v: t("console.identity.deviceCount", { n: n(person.devices.length) }) },
          { k: t("identities.columns.created"), v: dt(person.createdAt, { dateStyle: "medium" }), mono: true },
        ]}
      />

      {person.devices.length > 0 && (
        <Panel title={t("console.identity.devices")} flush>
          <ul className="divide-y divide-line-faint">
            {person.devices.map((d) => (
              <li
                key={d.id}
                title={d.trusted ? t("console.overview.deviceTrusted") : t("console.overview.deviceBlocked")}
                className="flex items-center gap-2 px-3 py-2 text-[0.8125rem] transition-colors duration-150 ease-out hover:bg-overlay-1"
              >
                <StateDot tone={d.trusted ? "good" : "warn"} />
                <span className="truncate text-ink-2">{d.label ?? d.id.slice(0, 12)}</span>
                <span className="sr-only">{d.trusted ? t("console.overview.deviceTrusted") : t("console.overview.deviceBlocked")}</span>
                <span className="tnum ml-auto font-mono text-[0.75rem] text-ink-3">{n(d.deviceTrust)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t("console.entity.recentActivity")} flush>
        {(events.data ?? []).length === 0 ? (
          <p className="px-3 py-5 text-center text-[0.8125rem] text-ink-3">{t("console.entity.noActivity")}</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {(events.data ?? []).slice(0, 8).map((e: AuditEvent) => (
              <li key={e.id} className="tick flex items-baseline gap-2 px-3 py-2 text-[0.8125rem] transition-colors duration-150 ease-out hover:bg-overlay-1">
                <span className="tnum font-mono text-[0.75rem] text-ink-3">{time(e.createdAt)}</span>
                <span className="truncate font-mono text-[0.75rem] text-ink-2">{e.eventType}</span>
                {(e.payload as { verdict?: string }).verdict && (
                  <span className="ml-auto">
                    <VerdictStamp size="sm" verdict={String((e.payload as { verdict: string }).verdict)} label={t(`verdict.${(e.payload as { verdict: string }).verdict}`)} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <OpenFull path={`/identities`} />
    </div>
  );
}

// ─── Device ──────────────────────────────────────────────────────────────────

function DeviceBody({ deviceId }: { deviceId: string }) {
  const { t, locale, dt, n } = useI18n();
  const identities = useAsync(() => api.identities(), []);
  if (identities.loading && !identities.data) return <Skeleton className="h-40" />;
  let owner: IdentityRow | undefined;
  let device: IdentityRow["devices"][number] | undefined;
  for (const person of identities.data ?? []) {
    const match = person.devices.find((d) => d.id === deviceId);
    if (match) {
      owner = person;
      device = match;
      break;
    }
  }
  if (!device || !owner) return <DrawerEmpty message={t("common.empty")} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StateDot tone={device.trusted ? "good" : "warn"} />
        <EntityHeading>{device.label ?? t("console.entity.device")}</EntityHeading>
        <Chip tone={toneForTrust(device.deviceTrust)}>
          {t("trust.device")} {n(device.deviceTrust)}
        </Chip>
      </div>
      <KeyValues
        items={[
          { k: t("console.identity.cols.owner"), v: owner.displayName },
          { k: t("console.identity.cols.state"), v: device.trusted ? t("console.overview.deviceTrusted") : t("console.overview.deviceBlocked") },
          { k: t("console.identity.lastSeen"), v: dt(device.lastSeen, { dateStyle: "medium", timeStyle: "short" }), mono: true },
          { k: "ID", v: device.id, mono: true },
        ]}
      />
      <OpenFull path={`/devices`} />
    </div>
  );
}

// ─── Audit event ─────────────────────────────────────────────────────────────

function EventBody({ id }: { id: string }) {
  const { t, locale, dt, n } = useI18n();
  const proof = useAsync(() => api.auditProof(id), [id]);
  if (proof.loading && !proof.data) return <Skeleton className="h-64" />;
  if (!proof.data) return <DrawerError message={proof.error} />;
  const e = proof.data.event;
  const payload = e.payload as { verdict?: string; risk?: { score: number; tier: string }; trust?: { identity: number; device: number }; policy?: { key: string; version: number }; action?: string };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <IdTag tone="neutral">#{n(e.seq)}</IdTag>
        <span className="font-mono text-[0.8125rem] text-ink">{e.eventType}</span>
        {payload.verdict && <VerdictStamp size="sm" verdict={payload.verdict} label={t(`verdict.${payload.verdict}`)} />}
      </div>

      <KeyValues
        items={[
          { k: t("audit.columns.when"), v: dt(e.createdAt, { dateStyle: "short", timeStyle: "medium" }), mono: true },
          ...(payload.action ? [{ k: t("console.audit.facetAction"), v: t(`actions.${payload.action}`) }] : []),
          ...(e.actorDid ? [{ k: t("console.audit.drawer.actor"), v: <HashValue value={e.actorDid} chars={8} />, mono: true }] : []),
          ...(e.assetUid ? [{ k: t("console.audit.drawer.asset"), v: e.assetUid, mono: true }] : []),
          ...(payload.policy ? [{ k: t("console.audit.drawer.policy"), v: `${payload.policy.key} v${payload.policy.version}`, mono: true }] : []),
          ...(payload.risk ? [{ k: t("console.audit.drawer.risk"), v: `${n(payload.risk.score)} · ${t(`risk.${payload.risk.tier}`)}`, mono: true }] : []),
          ...(payload.trust ? [{ k: t("console.audit.drawer.identityTrust"), v: n(payload.trust.identity), mono: true }] : []),
          ...(payload.trust ? [{ k: t("console.audit.drawer.deviceTrust"), v: n(payload.trust.device), mono: true }] : []),
        ]}
      />

      <Panel title={t("console.audit.drawer.chainHash")} bodyClass="bg-console">
        <div className="space-y-2">
          <HashValue value={e.chainHash} label={t("console.audit.drawer.chainHash")} chars={10} />
          <HashValue value={e.prevHash} label={t("console.audit.drawer.prevHash")} chars={10} />
          {e.ledgerTxId && <HashValue value={e.ledgerTxId} label={t("console.audit.drawer.ledgerTx")} chars={10} />}
          <div className="flex flex-wrap gap-2 border-t border-line-faint pt-2.5">
            <Chip tone={proof.data.chainIntact ? "good" : "bad"}>{proof.data.chainIntact ? `✓ ${t("audit.matches")}` : `✗ ${t("audit.mismatch")}`}</Chip>
            <Chip tone={proof.data.onChainMatches ? "good" : "warn"}>
              {t("audit.onChain")}: {proof.data.onChainMatches ? t("audit.matches") : t("audit.notAnchored")}
            </Chip>
            {e.block !== null && <IdTag tone="steel">#{n(e.block)}</IdTag>}
          </div>
        </div>
      </Panel>

      {e.incidentId && <OpenFull path={`/incidents/${e.incidentId}`} />}
    </div>
  );
}

// ─── Policy ──────────────────────────────────────────────────────────────────

function PolicyBody({ id }: { id: string }) {
  const { t, locale, dt, n } = useI18n();
  const policies = useAsync(() => api.policies(), []);
  if (policies.loading && !policies.data) return <Skeleton className="h-48" />;
  const p = (policies.data ?? []).find((x) => x.id === id || `${x.key}-v${x.version}` === id || x.key === id);
  if (!p) return <DrawerEmpty message={t("common.empty")} />;
  const c = p.spec.condition ?? {};
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <EntityHeading>{p.spec.name}</EntityHeading>
        <IdTag tone="brass">
          {p.key} v{p.version}
        </IdTag>
        <Chip tone={p.activeTo ? "neutral" : "good"}>{p.activeTo ? t("console.policy.superseded") : t("console.policy.active")}</Chip>
      </div>
      <KeyValues
        items={[
          { k: t("console.policy.who"), v: p.spec.subject.role.map((r) => t(`roles.${r}`)).join(", ") },
          { k: t("console.policy.what"), v: t(`actions.${p.spec.action}`) },
          { k: t("policies.columns.effect"), v: t(`policies.effects.${p.spec.effect}`) },
          { k: t("console.policy.workingHours"), v: c.hours ? `${String(c.hours[0]).padStart(2, "0")}:00 — ${String(c.hours[1]).padStart(2, "0")}:00` : "—", mono: true },
          { k: t("trust.device"), v: c.deviceTrusted ? t("console.policy.deviceTrusted") : t("console.policy.deviceAny") },
          { k: t("risk.label"), v: c.maxRiskTier ? t("console.policy.maxRisk", { tier: t(`risk.${c.maxRiskTier}`) }) : t("console.policy.anyRisk") },
          { k: t("console.policy.requiresApproval"), v: p.spec.approval ? `${t(`roles.${p.spec.approval.approverRole}`)} × ${n(p.spec.approval.count)}` : t("console.policy.noApproval") },
          { k: t("policies.columns.active"), v: p.activeTo ? dt(p.activeTo, { dateStyle: "medium" }) : dt(p.activeFrom, { dateStyle: "medium" }), mono: true },
        ]}
      />
      <div className="rounded-[var(--radius-panel)] border border-line bg-console px-3 py-2">
        <HashValue value={p.hash} label="hash" chars={10} />
      </div>
      <OpenFull path={`/policies?key=${encodeURIComponent(p.key)}`} />
    </div>
  );
}

// ─── Incident ────────────────────────────────────────────────────────────────

function IncidentBody({ id }: { id: string }) {
  const { t, locale, dt, time, n } = useI18n();
  const data = useAsync(() => api.incidentTimeline(id), [id]);
  if (data.loading && !data.data) return <Skeleton className="h-56" />;
  if (!data.data) return <DrawerError message={data.error} />;
  const { incident, items } = data.data;
  const trustPoints = items.filter((i): i is Extract<(typeof items)[number], { kind: "trust" }> => i.kind === "trust").map((p) => ({ at: p.at, score: p.scoreAfter }));
  const severityTone: Tone = incident.severity === "S3" ? "bad" : incident.severity === "S2" ? "warn" : "steel";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <IdTag tone={severityTone}>{incident.severity}</IdTag>
        <Chip tone={incident.status === "open" ? "bad" : "good"}>{t(`incidents.${incident.status}`)}</Chip>
        <Chip tone={toneForRisk(incident.peakRisk >= 60 ? "high" : incident.peakRisk >= 30 ? "elevated" : "low")}>
          {t("console.incident.peakRisk")} {n(incident.peakRisk)}
        </Chip>
      </div>
      <p
        className={cx(
          "rounded-[var(--radius-field)] border-l-2 px-3 py-2 text-[0.875rem] leading-[1.6] text-ink-2",
          incident.status === "open" ? "border-oxide bg-oxide-soft/40" : "border-line-strong bg-overlay-1",
        )}
      >
        {incident.summary}
      </p>
      <KeyValues
        items={[
          { k: t("console.incident.started"), v: dt(incident.openedAt, { dateStyle: "short", timeStyle: "medium" }), mono: true },
          { k: t("console.incident.affectedIdentity"), v: <HashValue value={incident.actorDid} chars={8} />, mono: true },
          { k: t("console.incident.eventCount"), v: n(items.filter((i) => i.kind === "audit").length), mono: true },
        ]}
      />
      {trustPoints.length > 1 && (
        <Panel title={t("incidents.trustDecay")}>
          <TrustHistoryChart points={trustPoints} tone="bad" height={100} time={time} />
        </Panel>
      )}
      <div className="flex flex-wrap gap-1.5">
        {incident.signals.map((s) => (
          <Chip key={s} tone="warn">
            {t(`risk.signals.${s}`)}
          </Chip>
        ))}
      </div>
      <OpenFull path={`/incidents/${incident.incidentId}`} />
    </div>
  );
}
