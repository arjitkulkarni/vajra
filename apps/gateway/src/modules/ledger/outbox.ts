/**
 * Ledger outbox — at-least-once anchoring without blocking decisions.
 * Rows are enqueued inside the same DB transaction as the fact they anchor; a worker submits them
 * to the ledger and patches the referencing row (tx id, block, anchored_at). Deterministic chaincode
 * rejections are recorded as `failed` (no retry); transport failures retry with backoff.
 */
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { ChainError, type ContractName } from "@vajra/chain-logic";
import type { Db } from "../../db/client";
import { assetTransfers, assetVersions, auditEvents, credentials, enrolments, faceVerifications, incidents, ledgerOutbox, policyVersions } from "../../db/schema";
import type { AppContext } from "../../context";
import type { LedgerDriver } from "./types";

export interface EnqueueInput {
  contract: ContractName;
  fn: string;
  args: string[];
  refTable?: "audit_events" | "asset_versions" | "asset_transfers" | "policy_versions" | "incidents" | "credentials" | "enrolments" | "face_verifications";
  refId?: string;
}

export async function enqueueLedger(db: Db, input: EnqueueInput): Promise<string> {
  const [row] = await db
    .insert(ledgerOutbox)
    .values({ contract: input.contract, fn: input.fn, args: input.args, refTable: input.refTable ?? null, refId: input.refId ?? null })
    .returning({ id: ledgerOutbox.id });
  return row!.id;
}

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private onAnchoredHandlers: Array<(refTable: string, refId: string, txId: string, block: number | null) => Promise<void>> = [];

  constructor(
    private readonly db: Db,
    private readonly ledger: () => LedgerDriver,
    private readonly log: AppContext["log"],
    private readonly intervalMs: number,
    private readonly isLedgerAvailable: () => Promise<boolean>,
  ) {}

  onAnchored(handler: (refTable: string, refId: string, txId: string, block: number | null) => Promise<void>): void {
    this.onAnchoredHandlers.push(handler);
  }

  start(): void {
    if (this.timer) return;
    /*
     * The timer owns this promise, so nothing else can catch it: an unhandled rejection here — a
     * dropped database connection is the usual one — would terminate the process. A failed round is
     * survivable by construction (rows stay `pending`), so log it and let the next tick retry.
     */
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.warn({ err: (e as Error).message }, "outbox tick failed; retrying next interval"));
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Process pending rows now; returns how many were committed. Used by tests and the demo. */
  async drain(maxRounds = 20): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = await this.tick();
      total += n;
      if (n === 0) break;
    }
    return total;
  }

  async pendingCount(): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(ledgerOutbox).where(eq(ledgerOutbox.status, "pending"));
    return r?.n ?? 0;
  }

  private async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let committed = 0;
    try {
      if (!(await this.isLedgerAvailable())) return 0;
      const rows = await this.db
        .select()
        .from(ledgerOutbox)
        .where(and(eq(ledgerOutbox.status, "pending"), lt(ledgerOutbox.attempts, 25)))
        .orderBy(asc(ledgerOutbox.createdAt))
        .limit(20);
      for (const row of rows) {
        try {
          const res = await this.ledger().submit(row.contract as ContractName, row.fn, row.args);
          await this.db
            .update(ledgerOutbox)
            .set({ status: "committed", txId: res.txId, block: res.block, attempts: row.attempts + 1, updatedAt: new Date(), lastError: null })
            .where(eq(ledgerOutbox.id, row.id));
          if (row.refTable && row.refId) await this.patchRef(row.refTable, row.refId, res.txId, res.block);
          committed += 1;
        } catch (e) {
          const err = e as Error;
          const deterministic = err instanceof ChainError;
          this.log.warn({ outbox: row.id, fn: `${row.contract}:${row.fn}`, err: err.message, deterministic }, "ledger submission failed");
          await this.db
            .update(ledgerOutbox)
            .set({ status: deterministic ? "failed" : "pending", attempts: row.attempts + 1, lastError: err.message, updatedAt: new Date() })
            .where(eq(ledgerOutbox.id, row.id));
          if (!deterministic) break; // transport trouble: stop this round, retry on the next tick
        }
      }
    } finally {
      this.running = false;
    }
    return committed;
  }

  private async patchRef(refTable: string, refId: string, txId: string, block: number | null): Promise<void> {
    const now = new Date();
    switch (refTable) {
      case "audit_events":
        await this.db.update(auditEvents).set({ ledgerTxId: txId, block, anchoredAt: now }).where(eq(auditEvents.id, refId));
        break;
      case "asset_versions":
        await this.db.update(assetVersions).set({ ledgerTxId: txId, block, status: "anchored" }).where(eq(assetVersions.id, refId));
        break;
      case "asset_transfers":
        await this.db.update(assetTransfers).set({ ledgerTxId: txId, block }).where(eq(assetTransfers.id, refId));
        break;
      case "policy_versions":
        await this.db.update(policyVersions).set({ ledgerTxId: txId, block }).where(eq(policyVersions.id, refId));
        break;
      case "incidents":
        await this.db.update(incidents).set({ ledgerTxId: txId, block }).where(eq(incidents.id, refId));
        break;
      case "credentials":
        await this.db.update(credentials).set({ ledgerTxId: txId, block }).where(eq(credentials.id, refId));
        break;
      case "enrolments":
        await this.db.update(enrolments).set({ ledgerTxId: txId, block }).where(eq(enrolments.id, refId));
        break;
      case "face_verifications":
        await this.db.update(faceVerifications).set({ ledgerTxId: txId, block, anchoredAt: now }).where(eq(faceVerifications.id, refId));
        break;
    }
    for (const h of this.onAnchoredHandlers) {
      try {
        await h(refTable, refId, txId, block);
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, "onAnchored handler failed");
      }
    }
  }
}
