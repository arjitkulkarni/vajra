/**
 * Request risk. RISK_MODE=local scores in-process with the explainable heuristics from @vajra/trust;
 * RISK_MODE=http sends the same facts to the Python service. Either way the gateway gathers the facts
 * (device novelty, travel, liveness failures, baseline hours, bursts, volume) so both scorers agree.
 * A timeout never lowers risk: on failure the tier is forced to `high` (fail closed).
 */
import { and, count, countDistinct, eq, gte, desc, sql } from "drizzle-orm";
import type { RequestContext, RiskResult } from "@vajra/contracts";
import { isImpossibleTravel, scoreRisk, type RiskInput } from "@vajra/trust";
import type { Db } from "../../db/client";
import { accessRequests, livenessAttestations } from "../../db/schema";
import type { AppContext } from "../../context";
import type { DeviceRow, UserRow } from "../identity/session";

export interface RiskFactsInput {
  user: UserRow;
  device: DeviceRow;
  isNewDevice: boolean;
  context: RequestContext;
  burstOverride?: number;
  now?: Date;
}

export async function gatherRiskFacts(db: Db, i: RiskFactsInput): Promise<RiskInput & { facts: Record<string, unknown> }> {
  const now = i.now ?? new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60_000);
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [failed] = await db
    .select({ n: count() })
    .from(livenessAttestations)
    .where(and(eq(livenessAttestations.userId, i.user.id), eq(livenessAttestations.verified, false), gte(livenessAttestations.createdAt, fifteenMinAgo)));

  const [burst] = await db
    .select({ n: count() })
    .from(accessRequests)
    .where(and(eq(accessRequests.userId, i.user.id), gte(accessRequests.decidedAt, fiveMinAgo)));

  const [volume] = await db
    .select({ n: countDistinct(accessRequests.assetId) })
    .from(accessRequests)
    .where(and(eq(accessRequests.userId, i.user.id), gte(accessRequests.decidedAt, dayStart)));

  // last known location of this person (any device)
  const lastWithGeo = (
    await db
      .select({ context: accessRequests.context, decidedAt: accessRequests.decidedAt })
      .from(accessRequests)
      .where(and(eq(accessRequests.userId, i.user.id), sql`${accessRequests.context} ->> 'geo' is not null`))
      .orderBy(desc(accessRequests.decidedAt))
      .limit(1)
  )[0];
  const prevGeo = lastWithGeo ? ((lastWithGeo.context as { geo?: { lat: number; lng: number } }).geo ?? null) : null;
  const travel =
    i.context.geo && prevGeo
      ? isImpossibleTravel({ ...prevGeo, at: lastWithGeo!.decidedAt }, { ...i.context.geo, at: now })
      : false;

  const localHour = i.context.localHour ?? now.getHours();
  const [hStart, hEnd] = i.user.baseline.hours;
  const outsideHours = hStart < hEnd ? !(localHour >= hStart && localHour < hEnd) : !(localHour >= hStart || localHour < hEnd);

  const burstCount = (i.burstOverride ?? 0) + Number(burst?.n ?? 0);
  const dailyBaseline = Math.max(1, i.user.baseline.dailyAssets);
  const volumeRatio = (Number(volume?.n ?? 0) + (i.burstOverride ?? 0)) / dailyBaseline;
  const userAgeHours = (now.getTime() - i.user.createdAt.getTime()) / 3_600_000;

  const input: RiskInput = {
    newDevice: i.isNewDevice,
    impossibleTravel: travel,
    failedLivenessRecent: Number(failed?.n ?? 0),
    outsideBaselineHours: outsideHours,
    burstCount,
    volumeRatio,
    userAgeHours,
  };
  return {
    ...input,
    facts: { localHour, baselineHours: i.user.baseline.hours, prevGeo, geo: i.context.geo ?? null, dailyBaseline },
  };
}

export async function scoreRequestRisk(ctx: Pick<AppContext, "config" | "db" | "log">, i: RiskFactsInput): Promise<RiskResult & { facts: Record<string, unknown> }> {
  const facts = await gatherRiskFacts(ctx.db, i);
  const { facts: extra, ...input } = facts;
  if (ctx.config.RISK_MODE === "local") return { ...scoreRisk(input), facts: extra };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.config.RISK_TIMEOUT_MS);
  try {
    const res = await fetch(`${ctx.config.RISK_SERVICE_URL}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`risk service ${res.status}`);
    const data = (await res.json()) as RiskResult;
    return { ...data, facts: extra };
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, "risk service unavailable — failing closed to tier high");
    return { score: 100, tier: "high", signals: ["risk_service_unavailable"], facts: extra };
  } finally {
    clearTimeout(timer);
  }
}

export async function riskHealth(ctx: Pick<AppContext, "config">): Promise<{ ok: boolean; detail?: string }> {
  if (ctx.config.RISK_MODE === "local") return { ok: true, detail: "in-process scorer" };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${ctx.config.RISK_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(t);
    return { ok: res.ok, detail: `risk service @ ${ctx.config.RISK_SERVICE_URL}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
