-- Customer negotiation tiers (UC 005): tier on customers, tier policy on
-- billing_settings, cap check on quotations. All three tables already carry
-- tenant_id + RLS; additive only.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'bronze';--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier_score integer;--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier_computed_at timestamp with time zone;--> statement-breakpoint
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_tier_chk;--> statement-breakpoint
ALTER TABLE customers ADD CONSTRAINT customers_tier_chk CHECK (tier IN ('bronze','silver','gold','platinum'));--> statement-breakpoint
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS tier_policy jsonb;--> statement-breakpoint
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS cap_status text;--> statement-breakpoint
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_cap_status_chk;--> statement-breakpoint
ALTER TABLE quotations ADD CONSTRAINT quotations_cap_status_chk
  CHECK (cap_status IS NULL OR cap_status IN ('within','pending_owner','owner_approved','owner_rejected'));
