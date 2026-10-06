-- The AM/PM weather a field log reported, for typed entries as well as scans (OCR also keeps it in edtr.ocr_payload).
ALTER TABLE edtr_line_items ADD COLUMN IF NOT EXISTS weather_am text;
--> statement-breakpoint
ALTER TABLE edtr_line_items ADD COLUMN IF NOT EXISTS weather_pm text;
--> statement-breakpoint
ALTER TABLE edtr_line_items ADD CONSTRAINT edtr_line_items_weather_chk
  CHECK (weather_am IN ('C', 'O', 'LR', 'HR', 'W', 'T') AND weather_pm IN ('C', 'O', 'LR', 'HR', 'W', 'T'));
--> statement-breakpoint
-- The incident log filters and tallies used-despite-warning incidents by rental (and so by customer company).
CREATE INDEX IF NOT EXISTS events_used_despite_warning_rental_idx
  ON events (tenant_id, (properties ->> 'rental_id'))
  WHERE name = 'equipment_used_despite_warning';
