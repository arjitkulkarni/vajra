import type { ContractName } from "@vajra/chain-logic";

export interface SubmitResult {
  txId: string;
  block: number | null;
  result: unknown;
}

export interface LedgerDriver {
  readonly mode: "lite" | "fabric";
  submit(contract: ContractName, fn: string, args: string[]): Promise<SubmitResult>;
  evaluate(contract: ContractName, fn: string, args: string[]): Promise<unknown>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}

export const GENESIS_HASH = "0".repeat(64);
