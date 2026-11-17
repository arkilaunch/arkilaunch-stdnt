-- Per-tenant return reminder points (7/5/3/2/1 days before) and the overdue alert.
-- No row means the baseline 5, 3, 1 + overdue, matching the column defaults.
CREATE TABLE IF NOT EXISTS "return_reminder_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"days_before" smallint[] DEFAULT '{5,3,1}' NOT NULL,
	"overdue" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_reminder_settings_days_chk" CHECK ("days_before" <@ '{7,5,3,2,1}'::smallint[])
);--> statement-breakpoint
ALTER TABLE "return_reminder_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_reminder_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "return_reminder_settings";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "return_reminder_settings" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "return_reminder_settings" TO app_authenticated;
