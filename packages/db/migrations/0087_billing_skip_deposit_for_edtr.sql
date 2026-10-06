-- Demo/office switch: when on, approved EDTR hours skip the deposit and wait for the weekly invoice. Off by default.
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS skip_deposit_for_edtr boolean NOT NULL DEFAULT false;
