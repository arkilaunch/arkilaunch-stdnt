ALTER TABLE rentals ADD COLUMN deposit_mode text NOT NULL DEFAULT 'shared' CONSTRAINT rentals_deposit_mode_chk CHECK (deposit_mode IN ('shared', 'per_machine'));--> statement-breakpoint
ALTER TABLE invoice_line_items ADD COLUMN equipment_id uuid REFERENCES equipment(id);--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN billing_week_start date;--> statement-breakpoint
CREATE TABLE rental_equipment_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rental_id uuid NOT NULL REFERENCES rentals(id),
  equipment_id uuid NOT NULL REFERENCES equipment(id),
  required numeric(14,2) NOT NULL CONSTRAINT rental_equipment_deposits_nonneg_chk CHECK (required >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_equipment_deposits_unit_uq UNIQUE (tenant_id, rental_id, equipment_id)
);--> statement-breakpoint
ALTER TABLE rental_equipment_deposits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rental_equipment_deposits FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON rental_equipment_deposits AS PERMISSIVE FOR ALL TO app_authenticated
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rental_equipment_deposits TO app_authenticated;--> statement-breakpoint
CREATE TABLE rental_billing_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rental_id uuid NOT NULL REFERENCES rentals(id),
  week_start date NOT NULL,
  no_work_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  bill_to_snapshot jsonb NOT NULL,
  site_snapshot jsonb NOT NULL,
  invoice_id uuid REFERENCES invoices(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES users(id),
  CONSTRAINT rental_billing_weeks_rental_week_uq UNIQUE (tenant_id, rental_id, week_start)
);--> statement-breakpoint
ALTER TABLE rental_billing_weeks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rental_billing_weeks FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON rental_billing_weeks AS PERMISSIVE FOR ALL TO app_authenticated
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rental_billing_weeks TO app_authenticated;
--> statement-breakpoint
CREATE FUNCTION enforce_rental_equipment_deposit_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rentals r WHERE r.id = NEW.rental_id AND r.tenant_id = NEW.tenant_id)
    OR NOT EXISTS (SELECT 1 FROM equipment e WHERE e.id = NEW.equipment_id AND e.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'equipment deposit tenant mismatch';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER rental_equipment_deposits_tenant_guard BEFORE INSERT OR UPDATE ON rental_equipment_deposits
  FOR EACH ROW EXECUTE FUNCTION enforce_rental_equipment_deposit_tenant();--> statement-breakpoint
CREATE FUNCTION enforce_billing_week_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'closed billing week is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.rental_id IS DISTINCT FROM NEW.rental_id
    OR OLD.week_start IS DISTINCT FROM NEW.week_start OR OLD.no_work_days IS DISTINCT FROM NEW.no_work_days
    OR OLD.usage_lines IS DISTINCT FROM NEW.usage_lines OR OLD.bill_to_snapshot IS DISTINCT FROM NEW.bill_to_snapshot
    OR OLD.site_snapshot IS DISTINCT FROM NEW.site_snapshot OR OLD.closed_at IS DISTINCT FROM NEW.closed_at
    OR OLD.closed_by IS DISTINCT FROM NEW.closed_by OR OLD.invoice_id IS NOT NULL OR NEW.invoice_id IS NULL
  ) THEN RAISE EXCEPTION 'closed billing week is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rentals r WHERE r.id = NEW.rental_id AND r.tenant_id = NEW.tenant_id)
    OR (NEW.invoice_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM invoices i WHERE i.id = NEW.invoice_id AND i.rental_id = NEW.rental_id AND i.tenant_id = NEW.tenant_id)) THEN
    RAISE EXCEPTION 'billing week tenant mismatch';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER rental_billing_weeks_integrity BEFORE INSERT OR UPDATE OR DELETE ON rental_billing_weeks
  FOR EACH ROW EXECUTE FUNCTION enforce_billing_week_integrity();--> statement-breakpoint
CREATE FUNCTION enforce_invoice_line_equipment_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.equipment_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM equipment e WHERE e.id = NEW.equipment_id AND e.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'invoice line equipment tenant mismatch';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER invoice_line_items_equipment_tenant_guard BEFORE INSERT OR UPDATE OF equipment_id, tenant_id ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_line_equipment_tenant();
