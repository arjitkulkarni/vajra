import { beforeEach, describe, expect, it } from "vitest";
import { AssetPassport, AuditTrail, ChainError, DIDRegistry, IdentityVerification, invoke, MemoryState, PolicyRegistry } from "./index";

let s: MemoryState;
beforeEach(async () => {
  s = new MemoryState();
  s.begin();
  await DIDRegistry.RegisterDID(s, "did:key:zA", "pkA", "vcA");
  s.begin();
  await DIDRegistry.RegisterDID(s, "did:key:zB", "pkB", "vcB");
});

describe("DIDRegistry", () => {
  it("registers once, revokes, and refuses re-registration while active", async () => {
    await expect(DIDRegistry.RegisterDID(s, "did:key:zA", "x", "y")).rejects.toBeInstanceOf(ChainError);
    s.begin();
    const r = await DIDRegistry.RevokeDID(s, "did:key:zA", "reason");
    expect(r.status).toBe("revoked");
  });
});

describe("AssetPassport", () => {
  it("mints, versions strictly in sequence, and keeps history", async () => {
    s.begin();
    await AssetPassport.Mint(s, "CAD-1", "did:key:zA", "h1", "cid1", "design", "high", "m");
    s.begin();
    await AssetPassport.AddVersion(s, "CAD-1", 2, "h2", "cid2");
    await expect(AssetPassport.AddVersion(s, "CAD-1", 4, "h4", "cid4")).rejects.toMatchObject({ code: "version_gap" });
    const hist = await AssetPassport.GetHistory(s, "CAD-1");
    expect(hist.map((h) => h.value?.version)).toEqual([1, 2]);
  });

  it("refuses to mint for an unregistered owner", async () => {
    s.begin();
    await expect(AssetPassport.Mint(s, "X", "did:key:zZ", "h", "c", "design", "high", "")).rejects.toMatchObject({ code: "owner_not_registered" });
  });

  it("enforces the two-person rule on chain for high-sensitivity transfers", async () => {
    s.begin();
    await AssetPassport.Mint(s, "CAD-1", "did:key:zA", "h1", "cid1", "design", "high", "m");
    s.begin();
    await expect(AssetPassport.Transfer(s, "CAD-1", "did:key:zA", "did:key:zB", "req", "")).rejects.toMatchObject({ code: "approval_required" });
    await expect(AssetPassport.Transfer(s, "CAD-1", "did:key:zA", "did:key:zB", "req", "did:key:zA")).rejects.toMatchObject({ code: "approver_is_requester" });
    await expect(AssetPassport.Transfer(s, "CAD-1", "did:key:zB", "did:key:zA", "req", "did:key:zA")).rejects.toMatchObject({ code: "not_owner" });
    s.begin();
    await DIDRegistry.RegisterDID(s, "did:key:zM", "pkM", "vcM");
    s.begin();
    const r = await AssetPassport.Transfer(s, "CAD-1", "did:key:zA", "did:key:zB", "req", "did:key:zM");
    expect(r.ownerDid).toBe("did:key:zB");
    expect(r.transfers).toBe(1);
  });

  it("low-sensitivity transfers do not need an approver", async () => {
    s.begin();
    await AssetPassport.Mint(s, "DOC-1", "did:key:zA", "h", "c", "document", "low", "");
    s.begin();
    const r = await AssetPassport.Transfer(s, "DOC-1", "did:key:zA", "did:key:zB", "req", "");
    expect(r.ownerDid).toBe("did:key:zB");
  });
});

describe("PolicyRegistry & AuditTrail", () => {
  it("anchors policy versions and audit events exactly once", async () => {
    s.begin();
    await PolicyRegistry.AnchorPolicyVersion(s, "POL-009", 3, "9c4e", "2026-08-01T00:00:00Z");
    await expect(PolicyRegistry.AnchorPolicyVersion(s, "POL-009", 3, "9c4e", "")).rejects.toMatchObject({ code: "already_anchored" });
    s.begin();
    const closed = await PolicyRegistry.ClosePolicyVersion(s, "POL-009", 3, "2026-09-01T00:00:00Z");
    expect(closed.activeTo).toBe("2026-09-01T00:00:00Z");
    s.begin();
    await AuditTrail.AnchorEvent(s, "ev-1", "chain1", "access.decision", "sum");
    await expect(AuditTrail.AnchorEvent(s, "ev-1", "chain1", "x", "y")).rejects.toMatchObject({ code: "already_anchored" });
    expect((await AuditTrail.GetEvent(s, "ev-1")).chainHash).toBe("chain1");
  });
});

describe("IdentityVerification", () => {
  const enrol = (did: string) => IdentityVerification.RecordEnrolment(s, did, "eidhash", "docsha", "doccid", "facesha", "facecid", "87", "71", "bundle");

  it("records an enrolment once and refuses a second while it is pending or approved", async () => {
    s.begin();
    const rec = await enrol("did:key:zA");
    expect(rec.status).toBe("pending");
    expect(rec.faceMatchScore).toBe(87);
    expect(rec.livenessScore).toBe(71);
    s.begin();
    await expect(enrol("did:key:zA")).rejects.toMatchObject({ code: "already_enrolled" });
  });

  it("refuses confidence scores outside 0-100", async () => {
    s.begin();
    await expect(IdentityVerification.RecordEnrolment(s, "did:key:zA", "e", "d", "c", "f", "fc", "140", "71", "b")).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(IdentityVerification.RecordEnrolment(s, "did:key:zA", "e", "d", "c", "f", "fc", "87", "nope", "b")).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("decides once, never by the person enrolling, and lets a denied identity re-enrol", async () => {
    s.begin();
    await enrol("did:key:zA");
    s.begin();
    await expect(IdentityVerification.DecideEnrolment(s, "did:key:zA", "approved", "did:key:zA", "")).rejects.toMatchObject({ code: "approver_is_requester" });
    await expect(IdentityVerification.DecideEnrolment(s, "did:key:zA", "maybe", "did:key:zB", "")).rejects.toMatchObject({ code: "invalid_argument" });
    const denied = await IdentityVerification.DecideEnrolment(s, "did:key:zA", "denied", "did:key:zB", "rh");
    expect(denied.status).toBe("denied");
    expect(denied.decidedBy).toBe("did:key:zB");
    await expect(IdentityVerification.DecideEnrolment(s, "did:key:zA", "approved", "did:key:zB", "")).rejects.toMatchObject({ code: "already_decided" });
    // A denial is not a permanent bar: the person may enrol again.
    s.begin();
    expect((await enrol("did:key:zA")).status).toBe("pending");
  });

  it("records each face check under its own id and never twice", async () => {
    s.begin();
    const v = await IdentityVerification.RecordVerification(s, "v1", "did:key:zA", "login", "fsha", "fcid", "91", "66", "bundle", "true");
    expect(v.passed).toBe(true);
    expect(v.purpose).toBe("login");
    await expect(IdentityVerification.RecordVerification(s, "v1", "did:key:zA", "login", "f", "c", "1", "1", "b", "true")).rejects.toMatchObject({ code: "already_recorded" });
    await expect(IdentityVerification.RecordVerification(s, "v2", "did:key:zA", "browse", "f", "c", "1", "1", "b", "true")).rejects.toMatchObject({ code: "invalid_argument" });
    expect((await IdentityVerification.GetVerification(s, "v1")).faceMatchScore).toBe(91);
    await expect(IdentityVerification.GetVerification(s, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("invoke()", () => {
  it("dispatches Contract:Function with string args", async () => {
    s.begin();
    const rec = (await invoke(s, "AuditTrail", "AnchorIncident", ["INC-1", "ch", "S3"])) as { severity: string };
    expect(rec.severity).toBe("S3");
    await expect(invoke(s, "AuditTrail", "Nope", [])).rejects.toMatchObject({ code: "unknown_function" });
    s.begin();
    const enrolment = (await invoke(s, "IdentityVerification", "RecordEnrolment", ["did:key:zA", "e", "d", "dc", "f", "fc", "87", "71", "b"])) as { status: string };
    expect(enrolment.status).toBe("pending");
  });
});
