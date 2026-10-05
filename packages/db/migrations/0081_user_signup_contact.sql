-- Customer contact details, separate from staff-confirmed KYC legal names.
ALTER TABLE users ADD COLUMN contact_first_name text,
  ADD COLUMN contact_last_name text,
  ADD COLUMN job_title text;--> statement-breakpoint

-- Keep the prior overload during rollout so the previous app remains compatible.
CREATE FUNCTION customer_register(
  p_tenant_slug text, p_email text, p_password_hash text,
  p_first_name text, p_last_name text, p_mobile text, p_job_title text
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_role_id uuid;
  v_user_id uuid;
BEGIN
  SELECT t.id INTO v_tenant_id FROM tenants t WHERE t.slug = p_tenant_slug AND t.status = 'active';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'storefront_tenant_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE email_key(u.email) = email_key(p_email)) THEN
    RAISE EXCEPTION 'email_taken' USING ERRCODE = '23505';
  END IF;
  SELECT r.id INTO v_role_id FROM roles r WHERE r.name = 'customer';
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'customer_role_not_seeded';
  END IF;
  INSERT INTO users (tenant_id, role_id, email, password_hash, status,
    contact_first_name, contact_last_name, phone, job_title)
  VALUES (v_tenant_id, v_role_id, lower(p_email), p_password_hash, 'active',
    p_first_name, p_last_name, p_mobile, p_job_title)
  RETURNING id INTO v_user_id;
  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION customer_register(text, text, text, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customer_register(text, text, text, text, text, text, text) TO app_authenticated;
