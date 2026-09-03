/**
 * HTTP surface. Every write and every decision passes through here; PostgREST (optional) serves
 * RLS-scoped reads in production. Bodies are validated with the zod schemas from @vajra/contracts,
 * so the web app and the gateway can never drift.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AccessRequestBodySchema,
  ApprovalDecideBodySchema,
  AssetUploadMetaSchema,
  AttestationBodySchema,
  EmployeeIdSchema,
  EnrolmentDecideBodySchema,
  LocaleSchema,
  LoginCompletePayloadSchema,
  OnboardCompleteBodySchema,
  PolicySpecSchema,
  SignupPayloadSchema,
  type AttestationBody,
  type Locale,
  type Role,
} from "@vajra/contracts";
import { accessRequests, assets, auditEvents, credentials, demoIdentities, devices, enrolments, faceVerifications, incidents, ledgerBlocks, ledgerOutbox, proofCertificates, users } from "../db/schema";
import type { AppContext } from "../context";
import { ApiError } from "../lib/errors";
import { b64u, ed25519, privateKeyFromSeed, sha256Hex } from "../lib/crypto";
import { isAllowedAddress, parseAllowlist } from "../lib/net";
import { appendAudit, getAuditEvent, listAudit, publicAuditEvent, verifyAuditChain } from "../modules/audit/service";
import { reconstructAt } from "../modules/audit/timetravel";
import { challengeApproval, decideApproval, getRequest, listApprovals, listRequests, requestAccess, stepUp, currentPermissions } from "../modules/access/service";
import { analystHealth, draftPolicy, explainDecision, explainIncident, explainPassport, parseAuditQuery } from "../modules/analyst/service";
import { closeIncident, getIncident, getIncidentTimeline, listIncidents, openIncidentFor, publicIncident, reportPresentationAttack } from "../modules/incident/service";
import { completeOnboarding, publicUser, startOnboarding } from "../modules/identity/onboarding";
import {
  completeLogin,
  decideEnrolment,
  enrolmentImage,
  getEnrolmentById,
  listEnrolments,
  listFaceVerifications,
  startLogin,
  startSignup,
  submitSignup,
} from "../modules/identity/enrolment";
import { createNonce } from "../modules/identity/nonces";
import { revokeIdentity } from "../modules/identity/revocation";
import { CONSOLE_KEY_HEADER, consoleKeyMatches } from "../lib/console-key";
import { consoleSession } from "../modules/identity/console-session";
import { requireRole, signSession, verifySession, type Session } from "../modules/identity/session";
import { verifySessionAttestation, type AttestationResult } from "../modules/identity/attestation";
import { LiteLedger } from "../modules/ledger/lite";
import { createPolicyVersion, listAllPolicyVersions } from "../modules/policy/store";
import { buildEvidencePackage, getProof, verifyEvidencePackage, verifyProof } from "../modules/proof/service";
import { getCustody, getGraph, getLineage, getPassport, listAssets } from "../modules/provenance/service";
import { listTrustEvents } from "../modules/trust/service";
import { deliverContent, uploadAsset } from "../modules/vault/service";
import { PRESETS, parseScenario } from "../modules/demo/scenario";
import { demoDeviceFingerprint, resetDemo } from "../modules/demo/seed";

const clientIp = (req: FastifyRequest): string | null => (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null;
const localeOf = (req: FastifyRequest): Locale => {
  const q = (req.query as { locale?: string }).locale;
  const parsed = LocaleSchema.safeParse(q ?? req.headers["accept-language"]?.slice(0, 2));
  return parsed.success ? parsed.data : "en";
};

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * Who is calling.
   *
   * Two credentials are accepted, and the order is the interesting part. A Bearer token is tried
   * first, so a person who actually signed in stays themselves: an administrator who verified their
   * face and then opened the console acts as *them* in the audit trail, not as the console operator.
   * The issued console link is the fallback, which is what makes the administrative plane reachable
   * on a database where nobody has been approved yet — see modules/identity/console-session.ts for
   * why that bootstrap is worth the trade it makes.
   *
   * A Bearer token that no longer verifies falls through to the link rather than refusing. Without
   * that, one stale `vajra_session` cookie would lock an operator out of the console they were
   * holding a valid link for, and the only way back would be to clear site data — which is a
   * miserable thing to discover during a demo.
   */
  const auth = async (req: FastifyRequest): Promise<Session> => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        return await verifySession(ctx, header.slice(7));
      } catch (err) {
        const fallback = await consoleSession(ctx, req);
        if (fallback) return fallback;
        throw err;
      }
    }
    const fromLink = await consoleSession(ctx, req);
    if (fromLink) return fromLink;
    throw ApiError.unauthorized("session_missing", "Verify your identity first.");
  };
  const scenarioOf = (req: FastifyRequest) => parseScenario(ctx.config, req.headers as Record<string, unknown>);
  const requireDemo = () => {
    if (!ctx.config.DEMO_MODE) throw ApiError.forbidden("demo_disabled", "Demo controls are disabled in this deployment.");
  };

  /**
   * The administrative plane is restricted to configured network addresses.
   *
   * `req.ip` and not `clientIp(req)`: Fastify runs here without `trustProxy`, so `req.ip` is the
   * socket peer, while `clientIp` prefers X-Forwarded-For — which the caller controls. A network
   * allowlist that reads a request header is not a control, it is a suggestion.
   *
   * Parsed per call rather than hoisted so that changing the environment and restarting is the
   * whole story; the list is a handful of strings and this is not a hot path.
   */
  const requireAdminNetwork = (req: FastifyRequest): void => {
    const allowlist = parseAllowlist(ctx.config.ADMIN_IP_ALLOWLIST);
    if (isAllowedAddress(req.ip, allowlist)) return;
    req.log.warn({ peer: req.ip, path: req.url }, "admin plane refused: address not allowlisted");
    throw ApiError.forbidden("admin_network_forbidden", "The administrative console is restricted to approved network addresses.");
  };

  /**
   * The console key: something you have to have been given, independent of who you are and where
   * you are. See lib/console-key.ts for why it is a keyed digest rather than a stored token.
   *
   * Read from the header, never from the query string. The browser puts the key in the URL exactly
   * once — on arrival — and thereafter presents it as a header, so it stays out of the address bar,
   * out of screenshots, and out of this gateway's own request log.
   */
  const requireConsoleKey = (req: FastifyRequest): void => {
    if (consoleKeyMatches(ctx.config.ADMIN_CONSOLE_SECRET, req.headers[CONSOLE_KEY_HEADER] as string | undefined)) return;
    req.log.warn({ peer: req.ip, path: req.url }, "admin plane refused: console key absent or wrong");
    throw ApiError.forbidden("admin_console_key_required", "This console is reached through its issued link.");
  };

  /**
   * Every administrator-only route goes through here rather than calling `requireRole` directly, so
   * the three checks cannot drift apart or be forgotten on a new route.
   *
   * Order matters. The key and the network are properties of the request, so they are cheap and
   * they refuse before anything is said about the session — a caller without the link learns only
   * that they need the link, not whether the account they presented is an administrator.
   */
  const adminOnly = (req: FastifyRequest, session: Session, ...also: Role[]): void => {
    requireConsoleKey(req);
    requireAdminNetwork(req);
    requireRole(session, "admin", ...also);
  };

  /**
   * The refusal shared by every route that is gated on a fresh liveness proof.
   *
   * Two failures arrive at this function and they must not be reported as the same thing. A proof
   * whose signature does not verify is a broken or replayed proof, and the honest thing to tell the
   * person holding the console is to try again. A proof the live AI check called a presentation
   * attack is somebody holding a screen up to a camera on an administrator's account, and that ends
   * with the incident engine locking every session the account has — so it is recorded and escalated
   * here rather than left to look like a hiccup.
   *
   * Always throws.
   */
  const refuseAttestation = async (session: Session, att: AttestationResult, body: AttestationBody, purpose: string, aftermath: string): Promise<never> => {
    if (!att.spoof) throw ApiError.forbidden("liveness_failed", `Your liveness proof did not verify. ${aftermath}`);
    const inc = await reportPresentationAttack(ctx, session.user, {
      purpose,
      liveProbability: body.spoofCheck?.liveProbability ?? null,
      samples: body.spoofCheck?.samples ?? null,
    });
    throw ApiError.forbidden(
      "presentation_attack",
      `The live check identified a presentation attack rather than a live face. ${aftermath} Every session on this identity has been locked and incident ${inc.incident?.incidentId ?? "—"} is open.`,
    );
  };

  // ─── health & stats ────────────────────────────────────────────────────────

  app.get("/v1/health", async () => {
    const snapshot = await ctx.health.snapshot(true);
    return { ...snapshot, analyst: analystHealth(ctx), pendingAnchors: await ctx.outbox.pendingCount() };
  });

  app.get("/v1/stats", async () => {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [decisions] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(accessRequests).where(gte(accessRequests.decidedAt, dayAgo));
    const [denied] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(accessRequests).where(and(gte(accessRequests.decidedAt, dayAgo), eq(accessRequests.decision, "DENY")));
    const [anchored] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(auditEvents).where(sql`${auditEvents.ledgerTxId} is not null`);
    const [events] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(auditEvents);
    const [openIncidents] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(incidents).where(eq(incidents.status, "open"));
    const [assetCount] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(assets).where(sql`${assets.deletedAt} is null`);
    const [people] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
    const [proofs] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(proofCertificates);
    const [blocks] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(ledgerBlocks);
    const [pendingEnrolments] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(enrolments).where(eq(enrolments.status, "pending"));
    const [faceChecks] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(faceVerifications);
    const [faceRefused] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(faceVerifications).where(eq(faceVerifications.passed, false));
    const [faceBytes] = await ctx.db.select({ n: sql<number>`coalesce(sum(${faceVerifications.imageSizeBytes}), 0)::bigint` }).from(faceVerifications);
    const [latency] = await ctx.db.select({ p95: sql<number>`coalesce(percentile_disc(0.95) within group (order by ${accessRequests.latencyMs}), 0)::int` }).from(accessRequests).where(gte(accessRequests.decidedAt, dayAgo));
    const chain = await verifyAuditChain(ctx.db);
    return {
      decisions24h: decisions?.n ?? 0,
      denied24h: denied?.n ?? 0,
      auditEvents: events?.n ?? 0,
      anchoredEvents: anchored?.n ?? 0,
      pendingAnchors: await ctx.outbox.pendingCount(),
      openIncidents: openIncidents?.n ?? 0,
      assets: assetCount?.n ?? 0,
      identities: people?.n ?? 0,
      proofs: proofs?.n ?? 0,
      ledgerBlocks: blocks?.n ?? 0,
      decisionP95Ms: latency?.p95 ?? 0,
      chainIntact: chain.ok,
      pendingEnrolments: pendingEnrolments?.n ?? 0,
      faceChecks: faceChecks?.n ?? 0,
      faceChecksRefused: faceRefused?.n ?? 0,
      /**
       * Enrolment and login captures are now kept on purpose, so the old "zero bytes" line would be
       * a lie. What is reported instead is the true footprint: how many frames, and how large — all
       * of it AES-256-GCM under a per-capture data key, addressed by content and anchored on chain.
       * Face *descriptors* are still never sent during a check; the match runs in the browser.
       */
      faceImageBytesStored: Number(faceBytes?.n ?? 0),
      faceImagesEncrypted: true,
    };
  });

  // ─── enrolment: signup → admin decision → login ────────────────────────────
  //
  // Both signup and login run the same five verifications and record the same evidence. Neither
  // route needs a session: a signup has no identity yet, and a login is how one is obtained.

  /** Pull the file parts and the JSON `payload` field out of one multipart body. */
  const readEnrolmentParts = async (req: FastifyRequest) => {
    const files: Record<string, { buffer: Buffer; mime: string } | null> = { idDocument: null, faceImage: null };
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname in files) files[part.fieldname] = { buffer: await part.toBuffer(), mime: part.mimetype || "application/octet-stream" };
        else await part.toBuffer(); // drain anything we did not ask for
      } else fields[part.fieldname] = String(part.value);
    }
    if (!fields.payload) throw ApiError.badRequest("payload_required", "The multipart body needs a JSON `payload` field.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(fields.payload);
    } catch {
      throw ApiError.badRequest("payload_invalid", "The `payload` field is not valid JSON.");
    }
    return { files, payload: parsed };
  };

  app.post("/v1/auth/signup/start", async () => startSignup(ctx));

  app.post("/v1/auth/signup/submit", async (req) => {
    const { files, payload } = await readEnrolmentParts(req);
    const body = SignupPayloadSchema.parse(payload);
    return submitSignup(ctx, body, { idDocument: files.idDocument ?? null, faceImage: files.faceImage ?? null }, clientIp(req));
  });

  /** Poll while an administrator decides. Public, and keyed on the enrolment id it was handed. */
  app.get("/v1/auth/signup/:id/status", async (req) => {
    const row = await getEnrolmentById(ctx, (req.params as { id: string }).id);
    return { id: row.id, employeeId: row.employeeId, status: row.status, decidedAt: row.decidedAt?.toISOString() ?? null, decisionReason: row.decisionReason };
  });

  app.post("/v1/auth/login/start", async (req) => {
    const body = z_loginStart.parse(req.body);
    return startLogin(ctx, body.employeeId);
  });

  app.post("/v1/auth/login/complete", async (req) => {
    const { files, payload } = await readEnrolmentParts(req);
    const body = LoginCompletePayloadSchema.parse(payload);
    return completeLogin(ctx, body, files.faceImage ?? null, clientIp(req));
  });

  // ─── admin: the enrolment queue ────────────────────────────────────────────

  app.get("/v1/admin/enrolments", async (req) => {
    const session = await auth(req);
    adminOnly(req, session, "auditor");
    return listEnrolments(ctx, (req.query as { status?: string }).status);
  });

  app.post("/v1/admin/enrolments/:id/challenge", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    return createNonce(ctx.db, "approval", (req.params as { id: string }).id, session.user.id);
  });

  /**
   * Approving someone else's access is exactly the kind of act that has to be provable, so it
   * carries the admin's own liveness attestation and lands on chain through the contract.
   */
  app.post("/v1/admin/enrolments/:id/decide", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    const { id } = req.params as { id: string };
    const body = EnrolmentDecideBodySchema.parse(req.body);
    const att = await verifySessionAttestation(ctx, session, body.attestation, "approval", id, session.device?.id ?? null);
    if (!att.ok) return refuseAttestation(session, att, body.attestation, "enrolment_decision", "The enrolment is untouched.");
    return decideEnrolment(ctx, session.user, att.attestationId, id, body.approve, body.reason);
  });

  /** The ID card and the enrolment capture, decrypted for the reviewer who is about to decide. */
  app.get("/v1/admin/enrolments/:id/image/:which", async (req, reply) => {
    const session = await auth(req);
    adminOnly(req, session, "auditor");
    const { id, which } = req.params as { id: string; which: string };
    if (which !== "id-document" && which !== "face") throw ApiError.badRequest("unknown_image", "Ask for id-document or face.");
    const image = await enrolmentImage(ctx, id, which);
    reply.header("content-type", image.mime);
    reply.header("cache-control", "no-store");
    reply.header("x-vajra-sha256", image.sha256);
    return reply.send(image.buffer);
  });

  app.get("/v1/admin/verifications", async (req) => {
    const session = await auth(req);
    adminOnly(req, session, "auditor", "manager");
    const q = req.query as { did?: string; purpose?: string; limit?: string };
    return listFaceVerifications(ctx, { did: q.did, purpose: q.purpose, limit: q.limit ? Number(q.limit) : 50 });
  });

  // ─── identity ──────────────────────────────────────────────────────────────

  /**
   * The pre-enrolment path: a live face and a DID, with no employee ID and no administrator.
   *
   * It is kept because the demo and the e2e suite drive it, and because it is still the shortest
   * honest demonstration of browser-held keys. It is *not* a second front door: it issues an active
   * identity without anyone approving it, so outside DEMO_MODE it is refused outright. The way into
   * a real deployment is /v1/auth/signup, which ends in an administrator's decision.
   */
  app.post("/v1/onboard/start", async () => {
    requireDemo();
    return startOnboarding(ctx);
  });

  app.post("/v1/onboard/complete", async (req) => {
    requireDemo();
    const body = OnboardCompleteBodySchema.parse(req.body);
    return completeOnboarding(ctx, body, clientIp(req));
  });

  /**
   * Extend a login. Refused for a console session, deliberately: minting a Bearer JWT here would
   * convert a tab-scoped link into a portable cookie that outlives the tab and travels without the
   * link — quietly widening the very thing the console key is supposed to bound. A console session
   * needs no refresh in any case; it is re-derived from the link on every single request.
   */
  app.post("/v1/session/refresh", async (req) => {
    const session = await auth(req);
    if (session.console) throw ApiError.forbidden("console_session", "A console session does not expire and cannot be exchanged for a token.");
    requireRole(session, "engineer", "manager", "auditor", "admin");
    return { sessionJwt: await signSession(ctx, session.user, session.claims.dev), user: publicUser(session.user) };
  });

  app.get("/v1/me", async (req) => {
    const session = await auth(req);
    const inc = await openIncidentFor(ctx.db, session.user.did);
    return {
      user: publicUser(session.user),
      device: session.device ? { id: session.device.id, deviceTrust: session.device.deviceTrust, trusted: session.device.trusted, label: session.device.label } : null,
      permissions: currentPermissions(session.user, session.device, (inc?.severity as "S1" | "S2" | "S3" | undefined) ?? null),
      incident: inc ? publicIncident(inc) : null,
      fresh: session.fresh,
      /**
       * Whether this connection may reach the administrative plane. The console uses it to say
       * *why* the door is shut instead of letting six panels fail one by one — it is a courtesy,
       * not the control: every admin route re-checks the address for itself.
       */
      adminNetwork: isAllowedAddress(req.ip, parseAllowlist(ctx.config.ADMIN_IP_ALLOWLIST)),
      /** Whether this connection presented the issued console link. Same courtesy as above. */
      adminConsole: consoleKeyMatches(ctx.config.ADMIN_CONSOLE_SECRET, req.headers[CONSOLE_KEY_HEADER] as string | undefined),
      /**
       * Whether the caller IS the console link rather than merely carrying it — i.e. there is no
       * face-verified login behind this session.
       *
       * `adminConsole` above says the link was presented; this says the link is what authenticated.
       * They differ for the case that matters most: an administrator who signed in with their face
       * and then opened the console gets `adminConsole: true` and `consoleSession: false`, and the
       * UI must keep asking that person for liveness proofs, because they can actually give one.
       *
       * The console reads this to skip a step-up dialog that would otherwise open, ask for a face,
       * and have nothing to sign the nonce with.
       */
      consoleSession: session.console === true,
    };
  });

  app.get("/v1/me/trust", async (req) => {
    const session = await auth(req);
    return {
      identity: await listTrustEvents(ctx.db, "identity", session.user.did, 60),
      device: session.device ? await listTrustEvents(ctx.db, "device", session.device.id, 60) : [],
    };
  });

  app.get("/v1/identities", async (req) => {
    const session = await auth(req);
    requireRole(session, "admin", "auditor", "manager");
    const rows = await ctx.db.select().from(users).orderBy(users.createdAt);
    const out = [];
    for (const u of rows) {
      const devs = await ctx.db.select().from(devices).where(eq(devices.userId, u.id));
      const cred = (await ctx.db.select().from(credentials).where(eq(credentials.userId, u.id)).limit(1))[0];
      out.push({
        ...publicUser(u),
        devices: devs.map((d) => ({ id: d.id, label: d.label, deviceTrust: d.deviceTrust, trusted: d.trusted, lastSeen: d.lastSeen.toISOString() })),
        credential: cred ? { status: cred.status, vcHash: cred.vcHash, issuedAt: cred.issuedAt.toISOString(), ledgerTxId: cred.ledgerTxId } : null,
      });
    }
    return out;
  });

  app.post("/v1/identities/:did/revoke/challenge", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    const { did } = req.params as { did: string };
    return createNonce(ctx.db, "revoke", did, session.user.id);
  });

  app.post("/v1/identities/:did/revoke", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    const { did } = req.params as { did: string };
    const body = z_revoke.parse(req.body);
    const target = (await ctx.db.select().from(users).where(eq(users.did, did)).limit(1))[0];
    if (!target) throw ApiError.notFound("user_not_found");
    if (target.did === session.user.did) throw ApiError.badRequest("cannot_revoke_self", "Revoking your own identity would leave no administrator.");
    const att = await verifySessionAttestation(ctx, session, body.attestation, "revoke", did, session.device?.id ?? null);
    if (!att.ok) return refuseAttestation(session, att, body.attestation, "revoke_identity", "Nothing was revoked.");
    return revokeIdentity(ctx, target, session.user, body.reason);
  });

  // ─── assets ────────────────────────────────────────────────────────────────

  app.get("/v1/assets", async (req) => {
    const session = await auth(req);
    return listAssets(ctx, session.user.did);
  });

  app.post("/v1/assets", async (req) => {
    const session = await auth(req);
    requireRole(session, "engineer", "manager", "admin");
    const parts = req.parts();
    let file: { buffer: Buffer; filename: string; mime: string } | null = null;
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === "file") file = { buffer: await part.toBuffer(), filename: part.filename, mime: part.mimetype || "application/octet-stream" };
      else fields[part.fieldname] = String(part.value);
    }
    if (!file) throw ApiError.badRequest("file_required", "Attach a file to mint an Asset Passport.");
    const meta = AssetUploadMetaSchema.parse({
      name: fields.name || file.filename,
      class: fields.class || "document",
      sensitivity: fields.sensitivity || "high",
      parentUid: fields.parentUid || undefined,
      lineageType: fields.lineageType || undefined,
      passportMeta: fields.passportMeta ? JSON.parse(fields.passportMeta) : undefined,
    });
    const result = await uploadAsset(ctx, session, file, meta);
    return { assetUid: result.asset.assetUid, name: result.asset.name, sensitivity: result.asset.sensitivity, class: result.asset.class, version: result.version.version, sha256: result.version.sha256Plain, cid: result.version.cid, trust: result.asset.assetTrust, derivativeStatus: result.derivativeStatus };
  });

  app.get("/v1/assets/:uid/passport", async (req) => {
    await auth(req);
    return getPassport(ctx, (req.params as { uid: string }).uid);
  });
  app.get("/v1/assets/:uid/custody", async (req) => {
    await auth(req);
    return getCustody(ctx, (req.params as { uid: string }).uid);
  });
  app.get("/v1/assets/:uid/lineage", async (req) => {
    await auth(req);
    return getLineage(ctx, (req.params as { uid: string }).uid);
  });
  app.get("/v1/assets/:uid/graph", async (req) => {
    await auth(req);
    return getGraph(ctx, (req.params as { uid: string }).uid);
  });

  app.post("/v1/assets/:uid/request", async (req) => {
    const session = await auth(req);
    const body = AccessRequestBodySchema.parse(req.body);
    return requestAccess(ctx, session, (req.params as { uid: string }).uid, body, scenarioOf(req), clientIp(req));
  });

  app.post("/v1/requests/:id/step-up", async (req) => {
    const session = await auth(req);
    const body = AttestationBodySchema.parse(req.body);
    return stepUp(ctx, session, (req.params as { id: string }).id, body);
  });

  app.get("/v1/requests", async (req) => {
    const session = await auth(req);
    return listRequests(ctx, session, Number((req.query as { limit?: string }).limit ?? 50));
  });

  app.get("/v1/requests/:id", async (req) => {
    const session = await auth(req);
    return getRequest(ctx, session, (req.params as { id: string }).id);
  });

  app.get("/v1/assets/:uid/content", async (req, reply) => {
    const { uid } = req.params as { uid: string };
    const { token } = req.query as { token?: string };
    if (!token) throw ApiError.forbidden("content_token_invalid", "This download needs an approved request.");
    const delivery = await deliverContent(ctx, uid, token);
    reply.header("content-type", delivery.asset.mime);
    reply.header("content-disposition", `attachment; filename="${delivery.asset.name.replace(/["\\]/g, "")}"`);
    reply.header("x-vajra-manifest", Buffer.from(JSON.stringify(delivery.manifest)).toString("base64"));
    reply.header("x-vajra-sha256", delivery.version.sha256Plain);
    return reply.send(delivery.plaintext);
  });

  app.get("/v1/assets/:uid/manifest", async (req) => {
    await auth(req);
    const passport = await getPassport(ctx, (req.params as { uid: string }).uid);
    return { note: "A signed manifest is issued with each download; this is the passport summary.", passport };
  });

  // ─── approvals ─────────────────────────────────────────────────────────────

  app.get("/v1/approvals", async (req) => {
    const session = await auth(req);
    return listApprovals(ctx, session);
  });
  app.post("/v1/approvals/:id/challenge", async (req) => {
    const session = await auth(req);
    return challengeApproval(ctx, session, (req.params as { id: string }).id);
  });
  app.post("/v1/approvals/:id/decide", async (req) => {
    const session = await auth(req);
    const body = ApprovalDecideBodySchema.parse(req.body);
    return decideApproval(ctx, session, (req.params as { id: string }).id, body);
  });

  // ─── policies ──────────────────────────────────────────────────────────────

  app.get("/v1/policies", async (req) => {
    await auth(req);
    return listAllPolicyVersions(ctx.db);
  });

  app.post("/v1/policies", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    const spec = PolicySpecSchema.parse(req.body);
    return createPolicyVersion(ctx, spec, session.user.did);
  });

  // ─── audit, proofs, incidents, time-travel ─────────────────────────────────

  app.get("/v1/audit", async (req) => {
    await auth(req);
    const q = req.query as Record<string, string | undefined>;
    const rows = await listAudit(ctx.db, {
      actorDid: q.actorDid,
      assetUid: q.assetUid,
      incidentId: q.incidentId,
      requestId: q.requestId,
      eventType: q.eventType,
      since: q.sinceHours ? new Date(Date.now() - Number(q.sinceHours) * 3_600_000) : undefined,
      limit: q.limit ? Number(q.limit) : 100,
      order: q.order === "asc" ? "asc" : "desc",
    });
    return rows.map(publicAuditEvent);
  });

  app.get("/v1/audit/:id/proof", async (req) => {
    await auth(req);
    const ev = await getAuditEvent(ctx.db, (req.params as { id: string }).id);
    if (!ev) throw ApiError.notFound("audit_event_not_found");
    let onChain: unknown = null;
    let ledgerError: string | null = null;
    if (ctx.health.isSimulatedDown("ledger")) ledgerError = "ledger_unavailable";
    else {
      try {
        onChain = await ctx.ledger.evaluate("AuditTrail", "GetEvent", [ev.id]);
      } catch (e) {
        ledgerError = (e as { code?: string }).code ?? "not_anchored_yet";
      }
    }
    const recomputed = sha256Hex(ev.prevHash + ev.payloadHash);
    return {
      event: publicAuditEvent(ev),
      recomputedChainHash: recomputed,
      chainIntact: recomputed === ev.chainHash,
      onChain,
      onChainMatches: !!onChain && (onChain as { chainHash?: string }).chainHash === ev.chainHash,
      ledgerError,
    };
  });

  app.get("/v1/audit/verify", async (req) => {
    await auth(req);
    return verifyAuditChain(ctx.db);
  });

  app.get("/v1/proofs/:certId", async (req) => {
    await auth(req);
    const proof = await getProof(ctx, (req.params as { certId: string }).certId);
    if (!proof) throw ApiError.notFound("proof_not_found");
    return proof;
  });

  app.post("/v1/verify/proof", async (req) => verifyProof(ctx, (req.body as { proof?: unknown }).proof ?? req.body));
  app.post("/v1/verify/evidence", async (req) => verifyEvidencePackage(ctx, (req.body as { package?: unknown }).package ?? req.body));

  app.get("/v1/incidents", async (req) => {
    const session = await auth(req);
    const q = req.query as { status?: string; mine?: string };
    return listIncidents(ctx, { status: q.status, actorDid: q.mine === "true" ? session.user.did : undefined });
  });

  app.get("/v1/incidents/:id/timeline", async (req) => {
    await auth(req);
    return getIncidentTimeline(ctx, (req.params as { id: string }).id);
  });

  app.get("/v1/incidents/:id/evidence", async (req) => {
    const session = await auth(req);
    requireRole(session, "auditor", "admin", "manager");
    return buildEvidencePackage(ctx, (req.params as { id: string }).id);
  });

  app.post("/v1/incidents/:id/close", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    const body = z_close.parse(req.body);
    const att = await verifySessionAttestation(ctx, session, body.attestation, "close_incident", (req.params as { id: string }).id, session.device?.id ?? null);
    if (!att.ok) return refuseAttestation(session, att, body.attestation, "close_incident", "The incident is still open.");
    return closeIncident(ctx, (req.params as { id: string }).id, session.user, body.status, body.reason);
  });

  app.post("/v1/incidents/:id/close/challenge", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    return createNonce(ctx.db, "close_incident", (req.params as { id: string }).id, session.user.id);
  });

  app.get("/v1/timetravel", async (req) => {
    const session = await auth(req);
    requireRole(session, "auditor", "admin", "manager");
    const q = req.query as { at?: string; did?: string; assetUid?: string };
    const at = q.at ? new Date(q.at) : new Date();
    if (Number.isNaN(at.getTime())) throw ApiError.badRequest("invalid_timestamp");
    return reconstructAt(ctx, at, { did: q.did, assetUid: q.assetUid });
  });

  // ─── analyst (LLM narratives — never in the decision path) ─────────────────

  app.post("/v1/analyst/explain", async (req) => {
    const session = await auth(req);
    const body = z_explain.parse(req.body);
    const locale = body.locale ?? localeOf(req);
    if (body.kind === "decision") {
      const r = await getRequest(ctx, session, body.id);
      const asset = r.assetUid ? await getPassport(ctx, r.assetUid).catch(() => null) : null;
      const n = await explainDecision(ctx, { trace: r.trace as never, action: r.action, assetName: asset?.name, risk: r.risk.score, tier: r.risk.tier, locale });
      return { ...n, locale, disclaimer: "analyst.disclaimer" };
    }
    if (body.kind === "incident") {
      const inc = await getIncident(ctx, body.id);
      const timeline = await getIncidentTimeline(ctx, body.id);
      const n = await explainIncident(ctx, { incidentId: inc.incidentId, severity: inc.severity, peakRisk: inc.peakRisk, signals: inc.signals, responses: inc.responses, events: timeline.items.length, timeline: timeline.items.slice(0, 40), locale });
      return { ...n, locale, disclaimer: "analyst.disclaimer" };
    }
    const p = await getPassport(ctx, body.id);
    const n = await explainPassport(ctx, { name: p.name, assetUid: p.assetUid, trust: p.trust.score, breakdown: p.trust.breakdown, sensitivity: p.sensitivity, versions: p.versions.length, owner: p.owner.displayName ?? p.owner.did, locale });
    return { ...n, locale, disclaimer: "analyst.disclaimer" };
  });

  app.post("/v1/analyst/query", async (req) => {
    const session = await auth(req);
    requireRole(session, "auditor", "admin", "manager");
    const body = z_query.parse(req.body);
    const people = await ctx.db.select({ did: users.did, name: users.displayName }).from(users);
    const assetRows = await ctx.db.select({ uid: assets.assetUid, name: assets.name }).from(assets);
    const filter = await parseAuditQuery(ctx, body.question, { dids: people, assets: assetRows });
    const rows = await listAudit(ctx.db, {
      actorDid: filter.actorDid,
      assetUid: filter.assetUid,
      eventType: filter.eventType,
      since: filter.sinceHours ? new Date(Date.now() - filter.sinceHours * 3_600_000) : undefined,
      limit: filter.limit ?? 50,
      order: "desc",
    });
    let events = rows.map(publicAuditEvent);
    if (filter.decision) events = events.filter((e) => (e.payload as { verdict?: string }).verdict === filter.decision);
    if (filter.action) events = events.filter((e) => (e.payload as { action?: string }).action === filter.action);
    return { filter, events, count: events.length, disclaimer: "analyst.disclaimer" };
  });

  app.post("/v1/analyst/policy-draft", async (req) => {
    const session = await auth(req);
    adminOnly(req, session);
    const body = z_draft.parse(req.body);
    const { draft, source } = await draftPolicy(ctx, body.description);
    const validation = PolicySpecSchema.safeParse(draft);
    return { draft, source, valid: validation.success, issues: validation.success ? [] : validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), disclaimer: "analyst.draft_disclaimer" };
  });

  // ─── demo controls (DEMO_MODE only) ────────────────────────────────────────

  app.get("/v1/demo/presets", async () => {
    requireDemo();
    return { presets: PRESETS };
  });

  app.post("/v1/demo/reset", async () => {
    requireDemo();
    const result = await resetDemo(ctx);
    await appendAudit(ctx, { eventType: "demo.reset", payload: { seededUsers: result.users.length } });
    return { ok: true, ...result };
  });

  /**
   * DEMO_MODE only: sign in as a seeded role. The server holds that identity's demo key and produces
   * the same nonce signature the browser would — so the whole cryptographic path is exercised,
   * including on the presenter's laptop with one camera.
   */
  app.post("/v1/demo/login", async (req) => {
    requireDemo();
    const body = z_demoLogin.parse(req.body);
    const row = (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.role, body.role)).limit(1))[0];
    if (!row) throw ApiError.notFound("demo_identity_missing", "Run POST /v1/demo/reset first.");
    const user = (await ctx.db.select().from(users).where(eq(users.id, row.userId)).limit(1))[0];
    if (!user) throw ApiError.notFound("demo_identity_missing");
    const fingerprint = body.deviceId ?? demoDeviceFingerprint(body.role);
    const device = (await ctx.db.select().from(devices).where(and(eq(devices.userId, user.id), eq(devices.fingerprintHash, fingerprint))).limit(1))[0];
    if (!device) throw ApiError.notFound("demo_device_missing");
    return { sessionJwt: await signSession(ctx, user, device.id), user: publicUser(user), device: { id: device.id, deviceTrust: device.deviceTrust, trusted: device.trusted } };
  });

  /** DEMO_MODE only: produce the attestation signature a seeded identity's browser would produce. */
  app.post("/v1/demo/sign", async (req) => {
    requireDemo();
    const session = await auth(req);
    const body = z_demoSign.parse(req.body);
    const row = (await ctx.db.select().from(demoIdentities).where(eq(demoIdentities.userId, session.user.id)).limit(1))[0];
    if (!row) throw ApiError.forbidden("not_a_demo_identity", "This identity holds its key in the browser — sign there.");
    const seed = b64u.decode(row.privateKeyJwk.d ?? "");
    const signature = ed25519.sign(privateKeyFromSeed(seed), body.nonce);
    return { signature, livenessMode: "simulated" as const };
  });

  app.post("/v1/demo/outage", async (req) => {
    requireDemo();
    const body = z_outage.parse(req.body);
    ctx.health.setOutage(body.dependency, body.down);
    await appendAudit(ctx, { eventType: "demo.outage", payload: { dependency: body.dependency, down: body.down }, anchor: body.dependency !== "ledger" || !body.down });
    return { ...(await ctx.health.snapshot(true)) };
  });

  app.post("/v1/demo/drain", async () => {
    requireDemo();
    return { committed: await ctx.outbox.drain(), pending: await ctx.outbox.pendingCount() };
  });

  app.get("/v1/ledger/blocks", async (req) => {
    await auth(req);
    const rows = await ctx.db.select().from(ledgerBlocks).orderBy(desc(ledgerBlocks.number)).limit(Number((req.query as { limit?: string }).limit ?? 25));
    const verify = ctx.ledger instanceof LiteLedger ? await ctx.ledger.verifyChain() : null;
    const [pending] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(ledgerOutbox).where(eq(ledgerOutbox.status, "pending"));
    return {
      mode: ctx.ledger.mode,
      blocks: rows.map((b) => ({ number: b.number, txId: b.txId, prevHash: b.prevHash, blockHash: b.blockHash, contract: b.contract, fn: b.fn, at: b.createdAt.toISOString() })),
      verification: verify,
      pending: pending?.n ?? 0,
    };
  });
}

// ─── small local schemas ─────────────────────────────────────────────────────

import { z } from "zod";
const z_loginStart = z.object({ employeeId: EmployeeIdSchema });
const z_revoke = z.object({ reason: z.string().min(3).max(500), attestation: AttestationBodySchema });
const z_close = z.object({ status: z.enum(["resolved", "false_positive"]), reason: z.string().min(3).max(500), attestation: AttestationBodySchema });
const z_explain = z.object({ kind: z.enum(["decision", "incident", "passport"]), id: z.string(), locale: LocaleSchema.optional() });
const z_query = z.object({ question: z.string().min(3).max(500) });
const z_draft = z.object({ description: z.string().min(3).max(500) });
const z_demoLogin = z.object({ role: z.enum(["engineer", "manager", "auditor", "admin"]), deviceId: z.string().optional() });
const z_demoSign = z.object({ nonce: z.string() });
const z_outage = z.object({ dependency: z.enum(["db", "ledger", "risk", "storage"]), down: z.boolean() });
