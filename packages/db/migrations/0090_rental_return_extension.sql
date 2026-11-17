-- Return condition evidence and approved extension charges; existing RLS and table-level UPDATE grants apply.
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS return_condition_notes text;
--> statement-breakpoint
ALTER TABLE equipment_assignments ADD CONSTRAINT equipment_assignments_return_condition_notes_len_chk CHECK (return_condition_notes IS NULL OR char_length(return_condition_notes) <= 2000);
--> statement-breakpoint
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS return_needs_repair boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE booking_change_requests ADD COLUMN IF NOT EXISTS charge_php numeric(14,2);
--> statement-breakpoint
ALTER TABLE booking_change_requests ADD CONSTRAINT booking_change_requests_charge_nonneg_chk CHECK (charge_php IS NULL OR charge_php >= 0);
--> statement-breakpoint
ALTER TABLE booking_change_requests ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id);
