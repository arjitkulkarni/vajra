/**
 * The `lite` ledger: the same chain-logic the Fabric chaincode runs, executed in-process against
 * a hash-chained block table. Every submission is one transaction sealed into one block:
 *
 *   txId      = sha256(number | prevHash | contract | fn | args | timestamp)
 *   blockHash = sha256(prevHash | txId | sha256(result))
 *
 * It is a development and fail-over driver, not a consensus network — and it says so in /health.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { invoke, type ChainState, type ContractName, type HistoryEntry } from "@vajra/chain-logic";
import type { Db } from "../../db/client";
import { ledgerBlocks, ledgerState, ledgerStateHistory } from "../../db/schema";
import { withTx } from "../../context";
import { canonicalJson, hashJson, sha256Hex } from "../../lib/crypto";
import { GENESIS_HASH, type LedgerDriver, type SubmitResult } from "./types";

class DbState implements ChainState {
  constructor(
    private readonly tx: Db,
    public readonly txId: string,
    private readonly block: number,
    public readonly timestamp: string,
    private readonly readOnly: boolean,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const rows = await this.tx.select().from(ledgerState).where(eq(ledgerState.key, key)).limit(1);
    return (rows[0]?.value as T) ?? null;
  }

  async put<T>(key: string, value: T): Promise<void> {
    if (this.readOnly) throw new Error("evaluate() cannot write state");
    await this.tx
      .insert(ledgerState)
      .values({ key, value: value as unknown, txId: this.txId, block: this.block, updatedAt: new Date(this.timestamp) })
      .onConflictDoUpdate({
        target: ledgerState.key,
        set: { value: value as unknown, txId: this.txId, block: this.block, updatedAt: new Date(this.timestamp) },
      });
    await this.tx.insert(ledgerStateHistory).values({ key, value: value as unknown, txId: this.txId, block: this.block, createdAt: new Date(this.timestamp) });
  }

  async history<T>(key: string): Promise<HistoryEntry<T>[]> {
    const rows = await this.tx.select().from(ledgerStateHistory).where(eq(ledgerStateHistory.key, key)).orderBy(asc(ledgerStateHistory.id));
    return rows.map((r) => ({ txId: r.txId, block: r.block, timestamp: r.createdAt.toISOString(), value: r.value as T, deleted: false }));
  }
}

export class LiteLedger implements LedgerDriver {
  readonly mode = "lite" as const;
  constructor(private readonly db: Db) {}

  async submit(contract: ContractName, fn: string, args: string[]): Promise<SubmitResult> {
    return withTx(this.db, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4343)`);
      const last = (await tx.select().from(ledgerBlocks).orderBy(desc(ledgerBlocks.number)).limit(1))[0];
      const number = (last?.number ?? 0) + 1;
      const prevHash = last?.blockHash ?? GENESIS_HASH;
      const timestamp = new Date().toISOString();
      const txId = sha256Hex(`${number}|${prevHash}|${contract}|${fn}|${canonicalJson(args)}|${timestamp}`);
      const state = new DbState(tx, txId, number, timestamp, false);
      const result = await invoke(state, contract, fn, args);
      const blockHash = sha256Hex(`${prevHash}|${txId}|${hashJson(result)}`);
      await tx.insert(ledgerBlocks).values({
        number,
        prevHash,
        blockHash,
        txId,
        contract,
        fn,
        args,
        result: result as unknown,
        createdAt: new Date(timestamp),
      });
      return { txId, block: number, result };
    });
  }

  async evaluate(contract: ContractName, fn: string, args: string[]): Promise<unknown> {
    const state = new DbState(this.db, "query", 0, new Date().toISOString(), true);
    return invoke(state, contract, fn, args);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const last = (await this.db.select().from(ledgerBlocks).orderBy(desc(ledgerBlocks.number)).limit(1))[0];
      return { ok: true, detail: `lite ledger · ${last?.number ?? 0} blocks` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async close(): Promise<void> {}

  /** Recompute the whole block chain; returns the first broken block, if any. */
  async verifyChain(): Promise<{ ok: boolean; blocks: number; brokenAt: number | null }> {
    const rows = await this.db.select().from(ledgerBlocks).orderBy(asc(ledgerBlocks.number));
    let prev = GENESIS_HASH;
    for (const b of rows) {
      const expected = sha256Hex(`${prev}|${b.txId}|${hashJson(b.result)}`);
      if (b.prevHash !== prev || b.blockHash !== expected) return { ok: false, blocks: rows.length, brokenAt: b.number };
      prev = b.blockHash;
    }
    return { ok: true, blocks: rows.length, brokenAt: null };
  }
}
