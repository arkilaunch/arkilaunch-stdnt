-- Tenant-editable rental agreement text and append-only signing evidence captured at checkout.
CREATE TABLE IF NOT EXISTS "rental_terms_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid REFERENCES "public"."users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_terms_settings_body_len_chk" CHECK (char_length("body") <= 50000)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"rental_id" uuid NOT NULL REFERENCES "public"."rentals"("id"),
	"quotation_id" uuid REFERENCES "public"."quotations"("id"),
	"customer_id" uuid NOT NULL REFERENCES "public"."customers"("id"),
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"terms_version" text NOT NULL,
	"terms_body" text NOT NULL,
	"signed_name" text NOT NULL,
	"signature_png" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "rental_agreements_name_chk" CHECK (char_length("signed_name") between 2 and 120),
	CONSTRAINT "rental_agreements_signature_chk" CHECK (char_length("signature_png") <= 140000)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_agreements_rental_idx" ON "rental_agreements" ("tenant_id","rental_id");--> statement-breakpoint
ALTER TABLE "rental_terms_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_terms_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_agreements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "rental_terms_settings";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rental_terms_settings" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "rental_agreements";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rental_agreements" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rental_terms_settings" TO app_authenticated;--> statement-breakpoint
-- Signing evidence is append-only: no UPDATE or DELETE.
GRANT SELECT, INSERT ON "rental_agreements" TO app_authenticated;
