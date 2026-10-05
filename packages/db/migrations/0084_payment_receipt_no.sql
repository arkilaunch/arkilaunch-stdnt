-- QA 34: the official receipt (OR) number staff write on an office payment; optional.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_no text;
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_receipt_no_len_chk CHECK (receipt_no IS NULL OR char_length(receipt_no) BETWEEN 1 AND 40);
