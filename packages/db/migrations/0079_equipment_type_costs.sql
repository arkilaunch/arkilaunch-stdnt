-- Fixed per-hour operating costs per equipment type. The rate card is the all-in
-- price; rent = rate - operator - maintenance - fuel (L/hr x diesel at quote time).
CREATE TABLE IF NOT EXISTS "equipment_type_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE restrict,
	"equipment_type_id" uuid NOT NULL REFERENCES "public"."equipment_types"("id"),
	"operator_hourly_php" numeric(10, 2) DEFAULT '0' NOT NULL,
	"maintenance_hourly_php" numeric(10, 2) DEFAULT '0' NOT NULL,
	"fuel_l_per_hour" numeric(8, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_type_costs_tenant_type_uq" UNIQUE ("tenant_id","equipment_type_id"),
	CONSTRAINT "equipment_type_costs_nonneg_chk" CHECK ("operator_hourly_php" >= 0 AND "maintenance_hourly_php" >= 0 AND "fuel_l_per_hour" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_type_costs_tenant_id_idx" ON "equipment_type_costs" ("tenant_id");--> statement-breakpoint
ALTER TABLE "equipment_type_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "equipment_type_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "equipment_type_costs";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "equipment_type_costs" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "equipment_type_costs" TO app_authenticated;--> statement-breakpoint
-- Backfill: every type a tenant has a current card for inherits its current company-wide values.
INSERT INTO "equipment_type_costs" ("tenant_id","equipment_type_id","operator_hourly_php","maintenance_hourly_php","fuel_l_per_hour")
SELECT DISTINCT ON (rc.tenant_id, rc.equipment_type_id) rc.tenant_id, rc.equipment_type_id,
  pp.operator_hourly_php, pp.maintenance_hourly_php, pp.fuel_l_per_hour
FROM "rate_cards" rc
JOIN "pricing_parameters" pp ON pp.tenant_id = rc.tenant_id AND pp.effective_to IS NULL
WHERE rc.effective_to IS NULL OR rc.effective_to > now()
ORDER BY rc.tenant_id, rc.equipment_type_id, pp.effective_from DESC
ON CONFLICT DO NOTHING;
