ALTER TABLE truck_requests DROP CONSTRAINT truck_requests_status_valid;--> statement-breakpoint
ALTER TABLE truck_requests ADD CONSTRAINT truck_requests_status_valid
  CHECK (status IN ('estimated','km_confirmed','agreed','paid','dispatched','cancelled','expired'));--> statement-breakpoint
