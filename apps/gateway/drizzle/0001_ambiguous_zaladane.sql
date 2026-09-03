CREATE TABLE IF NOT EXISTS "enrolments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"did" text NOT NULL,
	"display_name" text NOT NULL,
	"requested_role" text DEFAULT 'engineer' NOT NULL,
	"id_doc_mime" text NOT NULL,
	"id_doc_size_bytes" integer NOT NULL,
	"id_doc_sha256" text NOT NULL,
	"id_doc_cipher_sha256" text NOT NULL,
	"id_doc_cid" text NOT NULL,
	"id_doc_dek_wrapped" text NOT NULL,
	"id_doc_iv" text NOT NULL,
	"verification_id" text NOT NULL,
	"face_match_score" integer NOT NULL,
	"liveness_score" integer NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bundle_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_by_did" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"attestation_id" text,
	"ledger_tx_id" text,
	"block" integer,
	"audit_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "face_templates" (
	"user_id" text PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"template_wrapped" text NOT NULL,
	"template_iv" text NOT NULL,
	"template_dek_wrapped" text NOT NULL,
	"template_hash" text NOT NULL,
	"samples" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "face_verifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"did" text NOT NULL,
	"employee_id" text,
	"purpose" text NOT NULL,
	"image_mime" text DEFAULT 'image/jpeg' NOT NULL,
	"image_size_bytes" integer NOT NULL,
	"image_sha256" text NOT NULL,
	"image_cipher_sha256" text NOT NULL,
	"image_cid" text NOT NULL,
	"image_dek_wrapped" text NOT NULL,
	"image_iv" text NOT NULL,
	"face_match_score" integer NOT NULL,
	"liveness_score" integer NOT NULL,
	"liveness_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"liveness_mode" text DEFAULT 'faceapi' NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bundle_hash" text NOT NULL,
	"passed" boolean NOT NULL,
	"nonce" text NOT NULL,
	"signature" text NOT NULL,
	"device_id" text,
	"ip" text,
	"ledger_tx_id" text,
	"block" integer,
	"anchored_at" timestamp with time zone,
	"audit_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "employee_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enrolments_employee_id" ON "enrolments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrolments_status" ON "enrolments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_verifications_did" ON "face_verifications" USING btree ("did","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "face_verifications_purpose" ON "face_verifications" USING btree ("purpose","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_unique" UNIQUE("employee_id");