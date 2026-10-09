-- Demo switch: when on, an admin may approve scanned (OCR) days without an attested OCR accuracy measurement.
-- Every such approval is audit-logged. Off by default.
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS skip_ocr_accuracy_gate boolean NOT NULL DEFAULT false;
