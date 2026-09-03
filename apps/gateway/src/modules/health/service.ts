/**
 * Dependency health drives the fail-closed switches. Probes are cached briefly; DEMO_MODE allows
 * simulated outages so "stop the ledger on stage" works on a laptop without Docker.
 */
import type { Dependency, Health } from "@vajra/contracts";
import type { Config } from "../../config";
import type { DbHandle } from "../../db/client";
import type { LedgerDriver } from "../ledger/types";
import type { StorageDriver } from "../vault/storage";

type Probe = () => Promise<{ ok: boolean; detail?: string }>;

export class HealthService {
  private simulated = new Set<Dependency>();
  private cache: { at: number; value: Health } | null = null;
  private probes: Partial<Record<Dependency, Probe>> = {};

  constructor(
    private readonly config: Config,
    private readonly ttlMs = 3000,
  ) {}

  wire(deps: { dbHandle: DbHandle; ledger: () => LedgerDriver; storage: StorageDriver; risk: Probe }): void {
    this.probes = {
      db: async () => ({ ok: await deps.dbHandle.ping(), detail: `${deps.dbHandle.kind}` }),
      ledger: () => deps.ledger().health(),
      storage: () => deps.storage.health(),
      risk: deps.risk,
    };
  }

  setOutage(dep: Dependency, on: boolean): void {
    if (on) this.simulated.add(dep);
    else this.simulated.delete(dep);
    this.cache = null;
  }

  simulatedOutages(): Dependency[] {
    return [...this.simulated];
  }

  isSimulatedDown(dep: Dependency): boolean {
    return this.simulated.has(dep);
  }

  async snapshot(force = false): Promise<Health> {
    if (!force && this.cache && Date.now() - this.cache.at < this.ttlMs) return this.applySimulated(this.cache.value);
    const deps: Health["deps"] = {} as Health["deps"];
    for (const dep of ["db", "ledger", "risk", "storage"] as Dependency[]) {
      const probe = this.probes[dep];
      if (!probe) {
        deps[dep] = { ok: false, detail: "not wired" };
        continue;
      }
      try {
        deps[dep] = await probe();
      } catch (e) {
        deps[dep] = { ok: false, detail: (e as Error).message };
      }
    }
    const value: Health = {
      ok: Object.values(deps).every((d) => d.ok),
      deps,
      modes: {
        db: this.config.DB_MODE,
        ledger: this.config.LEDGER_MODE,
        storage: this.config.STORAGE_MODE,
        risk: this.config.RISK_MODE,
        analyst: this.config.ANALYST_MODE,
        demo: String(this.config.DEMO_MODE),
      },
      simulatedOutage: [],
      time: new Date().toISOString(),
    };
    this.cache = { at: Date.now(), value };
    return this.applySimulated(value);
  }

  /** The boolean map the decision engine consumes. */
  async depsForDecision(): Promise<Record<Dependency, boolean>> {
    const s = await this.snapshot();
    return { db: s.deps.db?.ok ?? false, ledger: s.deps.ledger?.ok ?? false, risk: s.deps.risk?.ok ?? false, storage: s.deps.storage?.ok ?? false };
  }

  private applySimulated(h: Health): Health {
    const deps = { ...h.deps };
    for (const dep of this.simulated) deps[dep] = { ok: false, detail: "simulated outage (demo)" };
    return { ...h, deps, ok: Object.values(deps).every((d) => d.ok), simulatedOutage: [...this.simulated], time: new Date().toISOString() };
  }
}
