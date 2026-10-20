-- Additive rental QA data. Apply before application deployment.
ALTER TABLE equipment_assignments ADD COLUMN return_condition text CHECK (return_condition IN ('good','wear','servicing','damaged'));
--> statement-breakpoint
CREATE TABLE storefront_promotions (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), equipment jsonb, trucking jsonb
);
--> statement-breakpoint
CREATE TABLE damage_assessments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 rental_id uuid NOT NULL REFERENCES rentals(id), assignment_id uuid NOT NULL REFERENCES equipment_assignments(id),
 agreement_id uuid NOT NULL REFERENCES rental_agreements(id), notes text NOT NULL CHECK (char_length(notes) <= 2000),
 evidence text NOT NULL CHECK (char_length(evidence) <= 2000), contract_clause text NOT NULL CHECK (char_length(contract_clause) <= 5000),
 amount numeric(14,2) NOT NULL CONSTRAINT damage_assessments_amount_chk CHECK (amount > 0),
 status text NOT NULL DEFAULT 'pending' CONSTRAINT damage_assessments_status_chk CHECK (status IN ('pending','approved','rejected')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid REFERENCES users(id), resolved_at timestamptz, reason text CHECK (char_length(reason) <= 1000),
 invoice_id uuid UNIQUE REFERENCES invoices(id)
);
--> statement-breakpoint
CREATE INDEX damage_assessments_tenant_rental_idx ON damage_assessments(tenant_id,rental_id);
--> statement-breakpoint
ALTER TABLE storefront_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_promotions FORCE ROW LEVEL SECURITY;
ALTER TABLE damage_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON storefront_promotions FOR ALL TO app_authenticated USING (tenant_id = current_setting('app.current_tenant_id',true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id',true)::uuid);
CREATE POLICY tenant_isolation ON damage_assessments FOR ALL TO app_authenticated USING (tenant_id = current_setting('app.current_tenant_id',true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id',true)::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON storefront_promotions, damage_assessments TO app_authenticated;
--> statement-breakpoint
-- Anonymous storefront read: active slug only, allowlisted promotional fields only.
CREATE FUNCTION catalog_get_promotions(p_slug text) RETURNS TABLE(equipment jsonb,trucking jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT CASE WHEN p.equipment->>'enabled'='true' THEN p.equipment ELSE NULL END, CASE WHEN p.trucking->>'enabled'='true' THEN p.trucking ELSE NULL END FROM public.storefront_promotions p JOIN public.tenants t ON t.id=p.tenant_id WHERE t.slug=p_slug AND t.status='active'
$$;
REVOKE ALL ON FUNCTION catalog_get_promotions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_get_promotions(text) TO app_authenticated;
