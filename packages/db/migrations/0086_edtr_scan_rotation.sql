-- How a reviewer turned an EDTR scan to read it upright; the stored image is never rewritten.
ALTER TABLE edtr ADD COLUMN IF NOT EXISTS scan_rotation smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE edtr ADD CONSTRAINT edtr_scan_rotation_chk CHECK (scan_rotation IN (0, 90, 180, 270));
