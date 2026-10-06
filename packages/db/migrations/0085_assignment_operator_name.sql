-- Deploy records the operator by name; no user account is needed for a machine operator.
ALTER TABLE equipment_assignments ADD COLUMN IF NOT EXISTS operator_name text;
--> statement-breakpoint
ALTER TABLE equipment_assignments ADD CONSTRAINT equipment_assignments_operator_name_len_chk CHECK (operator_name IS NULL OR char_length(operator_name) BETWEEN 1 AND 120);
