/**
 * Content-addressed storage for encrypted asset blobs. The address is a real CIDv1 (raw, sha2-256),
 * so `fs` and `ipfs`/`pinata` agree on the identifier of the same ciphertext.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../../config";
import { cidV1Raw } from "../../lib/crypto";

export interface StorageDriver {
  readonly mode: "fs" | "ipfs" | "pinata" | "memory";
  put(ciphertext: Buffer): Promise<{ cid: string }>;
  get(cid: string): Promise<Buffer>;
  exists(cid: string): Promise<boolean>;
  /** Re-hash the stored bytes and compare with the recorded ciphertext hash. */
  verify(cid: string, sha256Cipher: string): Promise<boolean>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

const digestOf = (b: Buffer) => createHash("sha256").update(b).digest();

class FsStorage implements StorageDriver {
  readonly mode = "fs" as const;
  constructor(private readonly dir: string) {}
  private file(cid: string) {
    if (!/^b[a-z2-7]+$/.test(cid)) throw new Error("invalid cid");
    return path.join(this.dir, cid.slice(0, 4), cid);
  }
  async put(ciphertext: Buffer) {
    const cid = cidV1Raw(digestOf(ciphertext));
    const f = this.file(cid);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, ciphertext);
    return { cid };
  }
  async get(cid: string) {
    return readFile(this.file(cid));
  }
  async exists(cid: string) {
    try {
      await stat(this.file(cid));
      return true;
    } catch {
      return false;
    }
  }
  async verify(cid: string, sha256Cipher: string) {
    const b = await this.get(cid);
    return digestOf(b).toString("hex") === sha256Cipher;
  }
  async health() {
    try {
      await mkdir(this.dir, { recursive: true });
      return { ok: true, detail: `fs · ${this.dir}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

class MemoryStorage implements StorageDriver {
  readonly mode = "memory" as const;
  private store = new Map<string, Buffer>();
  async put(ciphertext: Buffer) {
    const cid = cidV1Raw(digestOf(ciphertext));
    this.store.set(cid, ciphertext);
    return { cid };
  }
  async get(cid: string) {
    const b = this.store.get(cid);
    if (!b) throw new Error("not found");
    return b;
  }
  async exists(cid: string) {
    return this.store.has(cid);
  }
  async verify(cid: string, sha256Cipher: string) {
    return digestOf(await this.get(cid)).toString("hex") === sha256Cipher;
  }
  async health() {
    return { ok: true, detail: `memory · ${this.store.size} blobs` };
  }
}

/** Kubo (go-ipfs) HTTP API: /api/v0/add with raw-leaves + cid-version=1 reproduces our CIDs. */
class IpfsStorage implements StorageDriver {
  readonly mode = "ipfs" as const;
  constructor(private readonly apiUrl: string) {}
  async put(ciphertext: Buffer) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(ciphertext)]), "blob");
    const res = await fetch(`${this.apiUrl}/api/v0/add?cid-version=1&raw-leaves=true&hash=sha2-256&pin=true`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`ipfs add failed: ${res.status}`);
    const data = (await res.json()) as { Hash: string };
    return { cid: data.Hash };
  }
  async get(cid: string) {
    const res = await fetch(`${this.apiUrl}/api/v0/cat?arg=${cid}`, { method: "POST" });
    if (!res.ok) throw new Error(`ipfs cat failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async exists(cid: string) {
    try {
      await this.get(cid);
      return true;
    } catch {
      return false;
    }
  }
  async verify(cid: string, sha256Cipher: string) {
    return digestOf(await this.get(cid)).toString("hex") === sha256Cipher;
  }
  async health() {
    try {
      const res = await fetch(`${this.apiUrl}/api/v0/version`, { method: "POST" });
      return { ok: res.ok, detail: `ipfs @ ${this.apiUrl}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

class PinataStorage implements StorageDriver {
  readonly mode = "pinata" as const;
  constructor(private readonly jwt: string) {}
  async put(ciphertext: Buffer) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(ciphertext)]), "blob");
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: { Authorization: `Bearer ${this.jwt}` }, body: form });
    if (!res.ok) throw new Error(`pinata upload failed: ${res.status}`);
    const data = (await res.json()) as { IpfsHash: string };
    return { cid: data.IpfsHash };
  }
  async get(cid: string) {
    const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
    if (!res.ok) throw new Error(`pinata gateway ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async exists(cid: string) {
    try {
      await this.get(cid);
      return true;
    } catch {
      return false;
    }
  }
  async verify(cid: string, sha256Cipher: string) {
    return digestOf(await this.get(cid)).toString("hex") === sha256Cipher;
  }
  async health() {
    try {
      const res = await fetch("https://api.pinata.cloud/data/testAuthentication", { headers: { Authorization: `Bearer ${this.jwt}` } });
      return { ok: res.ok, detail: "pinata" };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}

export function createStorage(config: Config): StorageDriver {
  switch (config.STORAGE_MODE) {
    case "memory":
      return new MemoryStorage();
    case "ipfs":
      return new IpfsStorage(config.IPFS_API_URL);
    case "pinata":
      if (!config.PINATA_JWT) throw new Error("STORAGE_MODE=pinata requires PINATA_JWT");
      return new PinataStorage(config.PINATA_JWT);
    default:
      return new FsStorage(path.resolve(config.STORAGE_DIR));
  }
}
