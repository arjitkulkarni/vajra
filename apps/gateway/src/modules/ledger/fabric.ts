/**
 * Hyperledger Fabric driver — the production ledger. Uses the Fabric Gateway SDK (gRPC) to submit
 * `Contract:Function` transactions to `vajra-cc` on `vajrachannel`.
 *
 * Requires a running network (see fabric/README.md) and the enrolled identity's cert/key/TLS paths in .env.
 * This module is loaded only when LEDGER_MODE=fabric, so a laptop without Docker never touches gRPC.
 */
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import type { ContractName } from "@vajra/chain-logic";
import type { Config } from "../../config";
import type { LedgerDriver, SubmitResult } from "./types";

type GatewayModule = typeof import("@hyperledger/fabric-gateway");
type GrpcModule = typeof import("@grpc/grpc-js");

export class FabricLedger implements LedgerDriver {
  readonly mode = "fabric" as const;
  private gateway: import("@hyperledger/fabric-gateway").Gateway | null = null;
  private contract: import("@hyperledger/fabric-gateway").Contract | null = null;
  private client: import("@grpc/grpc-js").Client | null = null;

  constructor(private readonly config: Config) {}

  private async ensure(): Promise<import("@hyperledger/fabric-gateway").Contract> {
    if (this.contract) return this.contract;
    const c = this.config;
    if (!c.FABRIC_CERT_PATH || !c.FABRIC_KEY_PATH || !c.FABRIC_TLS_CERT_PATH)
      throw new Error("LEDGER_MODE=fabric needs FABRIC_CERT_PATH, FABRIC_KEY_PATH and FABRIC_TLS_CERT_PATH");
    const grpc: GrpcModule = await import("@grpc/grpc-js");
    const fg: GatewayModule = await import("@hyperledger/fabric-gateway");

    const tlsRootCert = readFileSync(c.FABRIC_TLS_CERT_PATH);
    this.client = new grpc.Client(c.FABRIC_PEER_ENDPOINT, grpc.credentials.createSsl(tlsRootCert), {
      "grpc.ssl_target_name_override": c.FABRIC_PEER_HOST_ALIAS,
    });
    const credentials = readFileSync(c.FABRIC_CERT_PATH);
    const identity = { mspId: c.FABRIC_MSP_ID, credentials };
    const signer = fg.signers.newPrivateKeySigner(createPrivateKey(readFileSync(c.FABRIC_KEY_PATH)));
    this.gateway = fg.connect({
      client: this.client,
      identity,
      signer,
      hash: fg.hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15000 }),
      submitOptions: () => ({ deadline: Date.now() + 5000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    const network = this.gateway.getNetwork(c.FABRIC_CHANNEL);
    this.contract = network.getContract(c.FABRIC_CHAINCODE);
    return this.contract;
  }

  async submit(contract: ContractName, fn: string, args: string[]): Promise<SubmitResult> {
    const c = await this.ensure();
    const proposal = c.newProposal(`${contract}:${fn}`, { arguments: args });
    const transaction = await proposal.endorse();
    const commit = await transaction.submit();
    const status = await commit.getStatus();
    if (!status.successful) throw new Error(`Fabric transaction ${status.transactionId} failed with code ${status.code}`);
    const raw = Buffer.from(transaction.getResult()).toString("utf8");
    return { txId: status.transactionId, block: Number(status.blockNumber), result: raw ? JSON.parse(raw) : null };
  }

  async evaluate(contract: ContractName, fn: string, args: string[]): Promise<unknown> {
    const c = await this.ensure();
    const bytes = await c.evaluateTransaction(`${contract}:${fn}`, ...args);
    const raw = Buffer.from(bytes).toString("utf8");
    return raw ? JSON.parse(raw) : null;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.ensure();
      return { ok: true, detail: `fabric · ${this.config.FABRIC_CHANNEL}/${this.config.FABRIC_CHAINCODE} @ ${this.config.FABRIC_PEER_ENDPOINT}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async close(): Promise<void> {
    this.gateway?.close();
    this.client?.close();
    this.gateway = null;
    this.contract = null;
    this.client = null;
  }
}
