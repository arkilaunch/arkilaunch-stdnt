CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  booking_id uuid REFERENCES rentals(id),
  category text NOT NULL CONSTRAINT support_tickets_category_chk CHECK (category IN ('booking_equipment','payment','equipment_issue','account','other')),
  subject text NOT NULL CONSTRAINT support_tickets_subject_chk CHECK (length(trim(subject)) BETWEEN 1 AND 120),
  message text NOT NULL CONSTRAINT support_tickets_message_chk CHECK (length(trim(message)) BETWEEN 1 AND 4000),
  priority text NOT NULL DEFAULT 'medium' CONSTRAINT support_tickets_priority_chk CHECK (priority IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CONSTRAINT support_tickets_status_chk CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_tenant_code_uq UNIQUE (tenant_id, code)
);
--> statement-breakpoint
CREATE INDEX support_tickets_tenant_status_idx ON support_tickets(tenant_id,status);
CREATE INDEX support_tickets_tenant_creator_idx ON support_tickets(tenant_id,created_by);
--> statement-breakpoint
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_tickets FOR ALL TO app_authenticated
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON support_tickets TO app_authenticated;
