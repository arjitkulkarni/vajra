CREATE TABLE IF NOT EXISTS "access_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"actor_did" text NOT NULL,
	"asset_id" text,
	"asset_uid" text,
	"action" text NOT NULL,
	"action_class" text NOT NULL,
	"context" jsonb NOT NULL,
	"device_id" text,
	"policy_version_id" text,
	"identity_trust" integer NOT NULL,
	"device_trust" integer NOT NULL,
	"asset_trust" integer,
	"risk_score" integer NOT NULL,
	"risk_tier" text NOT NULL,
	"risk_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"step_up_required" boolean DEFAULT false NOT NULL,
	"step_up_ok" boolean,
	"approval_id" text,
	"cert_id" text,
	"content_token" text,
	"content_used" boolean DEFAULT false NOT NULL,
	"to_did" text,
	"audit_event_id" text,
	"incident_id" text,
	"expires_at" timestamp with time zone,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"kind" text DEFAULT 'two_person' NOT NULL,
	"required_role" text NOT NULL,
	"required_count" integer DEFAULT 1 NOT NULL,
	"requester_did" text NOT NULL,
	"approver_id" text,
	"approver_did" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attestation_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_transfers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" text NOT NULL,
	"from_did" text NOT NULL,
	"to_did" text NOT NULL,
	"request_id" text,
	"approval_id" text,
	"approver_did" text,
	"ledger_tx_id" text,
	"block" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" text NOT NULL,
	"version" integer NOT NULL,
	"sha256_plain" text NOT NULL,
	"sha256_cipher" text NOT NULL,
	"cid" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"dek_wrapped" text NOT NULL,
	"iv" text NOT NULL,
	"parent_sha256" text,
	"ledger_tx_id" text,
	"block" integer,
	"status" text DEFAULT 'anchoring' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_uid" text NOT NULL,
	"name" text NOT NULL,
	"mime" text DEFAULT 'application/octet-stream' NOT NULL,
	"class" text NOT NULL,
	"sensitivity" text NOT NULL,
	"owner_did" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"parent_asset_id" text,
	"lineage_type" text DEFAULT 'root' NOT NULL,
	"asset_trust" integer DEFAULT 0 NOT NULL,
	"trust_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"passport_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_asset_uid_unique" UNIQUE("asset_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"event_type" text NOT NULL,
	"actor_did" text,
	"asset_uid" text,
	"request_id" text,
	"incident_id" text,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"prev_hash" text NOT NULL,
	"chain_hash" text NOT NULL,
	"ledger_tx_id" text,
	"block" integer,
	"anchored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "break_glass_grants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"approval_id" text,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credentials" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"vc_jwt" text NOT NULL,
	"vc_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"ledger_tx_id" text,
	"block" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "demo_identities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"private_key_jwk" jsonb NOT NULL,
	"device_fingerprint_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_identities_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "devices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"label" text,
	"device_trust" integer DEFAULT 40 NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"last_geo" jsonb,
	"last_ip" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_packages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" text NOT NULL,
	"incident_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"package_hash" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_packages_package_id_unique" UNIQUE("package_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" text NOT NULL,
	"actor_did" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"close_reason" text,
	"peak_risk" integer DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ledger_tx_id" text,
	"block" integer,
	CONSTRAINT "incidents_incident_id_unique" UNIQUE("incident_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_blocks" (
	"number" bigint PRIMARY KEY NOT NULL,
	"prev_hash" text NOT NULL,
	"block_hash" text NOT NULL,
	"tx_id" text NOT NULL,
	"contract" text NOT NULL,
	"fn" text NOT NULL,
	"args" jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_outbox" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract" text NOT NULL,
	"fn" text NOT NULL,
	"args" jsonb NOT NULL,
	"ref_table" text,
	"ref_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"tx_id" text,
	"block" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"tx_id" text NOT NULL,
	"block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_state_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"tx_id" text NOT NULL,
	"block" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "liveness_attestations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nonce" text NOT NULL,
	"purpose" text NOT NULL,
	"ref_id" text,
	"signature" text NOT NULL,
	"attestation_hash" text NOT NULL,
	"mode" text NOT NULL,
	"verified" boolean NOT NULL,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "liveness_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"purpose" text NOT NULL,
	"ref_id" text,
	"challenge" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policies" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"active_to" timestamp with time zone,
	"created_by" text,
	"ledger_tx_id" text,
	"block" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proof_certificates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cert_id" text NOT NULL,
	"request_id" text,
	"audit_event_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_certificates_cert_id_unique" UNIQUE("cert_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trust_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"score_after" integer NOT NULL,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"did" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"identity_trust" integer DEFAULT 60 NOT NULL,
	"public_key_jwk" jsonb NOT NULL,
	"baseline" jsonb NOT NULL,
	"liveness_mode" text DEFAULT 'faceapi' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "users_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_actor" ON "access_requests" USING btree ("actor_did","decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_asset" ON "access_requests" USING btree ("asset_uid","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_versions_asset_version" ON "asset_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_versions_sha" ON "asset_versions" USING btree ("sha256_plain");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_events_seq" ON "audit_events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_actor" ON "audit_events" USING btree ("actor_did","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_asset" ON "audit_events" USING btree ("asset_uid","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_incident" ON "audit_events" USING btree ("incident_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_fp" ON "devices" USING btree ("user_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_outbox_status" ON "ledger_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_state_history_key" ON "ledger_state_history" USING btree ("key","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "policy_versions_key_version" ON "policy_versions" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trust_events_subject" ON "trust_events" USING btree ("subject_type","subject_id","created_at");