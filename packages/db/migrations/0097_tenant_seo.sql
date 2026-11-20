-- CR: tenant-seo-geo P3. A tenant's search and AI-answer presence: home title and description overrides, schema.org
-- business type, service areas, business location, profile links (sameAs), and an opt-in to publish the yard's hours
-- (tenant_calendar). Expand-only: new nullable/defaulted columns, a new write/read function pair (the branding pair is
-- untouched, so a Details save can never wipe these), and the public catalog functions re-created with the new
-- columns. content_updated_at feeds sitemap <lastmod>.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "seo_title" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "seo_description" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "business_type" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "service_areas" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "latitude" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "same_as" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "publish_hours" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "content_updated_at" timestamptz NOT NULL DEFAULT now();--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "content_updated_at" timestamptz NOT NULL DEFAULT now();--> statement-breakpoint

ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_seo_title_len";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_seo_title_len"
  CHECK ("seo_title" IS NULL OR char_length("seo_title") BETWEEN 1 AND 70);--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_seo_description_len";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_seo_description_len"
  CHECK ("seo_description" IS NULL OR char_length("seo_description") BETWEEN 1 AND 160);--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_business_type_known";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_business_type_known"
  CHECK ("business_type" IS NULL OR "business_type" IN ('LocalBusiness', 'HomeAndConstructionBusiness', 'GeneralContractor'));--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_service_areas_bounded";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_service_areas_bounded"
  CHECK (cardinality("service_areas") <= 20 AND char_length(array_to_string("service_areas", '')) <= 2000);--> statement-breakpoint
-- Both or neither, and inside the Philippines: a swapped lat/long lands outside the box.
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_location_ph";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_location_ph"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR ("latitude" BETWEEN 4.5 AND 21.5 AND "longitude" BETWEEN 116 AND 127)));--> statement-breakpoint
-- Lands in an href on a public page: https only, no whitespace, bounded.
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_same_as_https";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_same_as_https"
  CHECK (cardinality("same_as") <= 8 AND array_position("same_as", NULL) IS NULL
    AND (cardinality("same_as") = 0 OR array_to_string("same_as", E'\n') ~ '^https://\S{1,300}(\nhttps://\S{1,300})*$'));--> statement-breakpoint

-- lastmod moves only when something a crawler reads changes (not runtime hours or deposits).
CREATE OR REPLACE FUNCTION touch_content_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "tenants_content_touch" ON "tenants";--> statement-breakpoint
CREATE TRIGGER "tenants_content_touch" BEFORE UPDATE ON "tenants" FOR EACH ROW
  WHEN ((OLD.legal_name, OLD.logo_key, OLD.hero_key, OLD.tagline, OLD.about, OLD.phone, OLD.contact_email, OLD.address,
         OLD.city, OLD.province, OLD.facebook_url, OLD.seo_title, OLD.seo_description, OLD.business_type, OLD.service_areas,
         OLD.latitude, OLD.longitude, OLD.same_as, OLD.publish_hours)
    IS DISTINCT FROM
        (NEW.legal_name, NEW.logo_key, NEW.hero_key, NEW.tagline, NEW.about, NEW.phone, NEW.contact_email, NEW.address,
         NEW.city, NEW.province, NEW.facebook_url, NEW.seo_title, NEW.seo_description, NEW.business_type, NEW.service_areas,
         NEW.latitude, NEW.longitude, NEW.same_as, NEW.publish_hours))
  EXECUTE FUNCTION touch_content_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS "equipment_content_touch" ON "equipment";--> statement-breakpoint
CREATE TRIGGER "equipment_content_touch" BEFORE UPDATE ON "equipment" FOR EACH ROW
  WHEN ((OLD.model, OLD.equipment_type_id, OLD.photo_uri, OLD.option_groups, OLD.photo_credit, OLD.photo_source_url, OLD.retired_at)
    IS DISTINCT FROM
        (NEW.model, NEW.equipment_type_id, NEW.photo_uri, NEW.option_groups, NEW.photo_credit, NEW.photo_source_url, NEW.retired_at))
  EXECUTE FUNCTION touch_content_updated_at();--> statement-breakpoint

-- The SEO write. Same contract as tenants_update_branding: the caller picks the tenant (JWT, or a platform admin's
-- choice), the platform tenant is refused, every write is audited.
CREATE OR REPLACE FUNCTION tenants_update_seo(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_seo_title text,
  p_seo_description text,
  p_business_type text,
  p_service_areas text[],
  p_latitude numeric,
  p_longitude numeric,
  p_same_as text[],
  p_publish_hours boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tenants SET
    seo_title = p_seo_title, seo_description = p_seo_description, business_type = p_business_type,
    service_areas = coalesce(p_service_areas, '{}'), latitude = p_latitude, longitude = p_longitude,
    same_as = coalesce(p_same_as, '{}'), publish_hours = coalesce(p_publish_hours, false)
  WHERE id = p_tenant_id AND slug <> 'arkilaunch-platform';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_not_found';
  END IF;
  INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, reason)
  VALUES (p_tenant_id, p_actor_user_id, 'UPDATE', 'tenant_seo', p_tenant_id, NULL);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_update_seo(uuid, uuid, text, text, text, text[], numeric, numeric, text[], boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_update_seo(uuid, uuid, text, text, text, text[], numeric, numeric, text[], boolean) TO app_authenticated;--> statement-breakpoint

DROP FUNCTION IF EXISTS tenants_get_seo(uuid);--> statement-breakpoint
CREATE FUNCTION tenants_get_seo(p_tenant_id uuid)
RETURNS TABLE (
  seo_title text, seo_description text, business_type text, service_areas text[], latitude numeric, longitude numeric,
  same_as text[], publish_hours boolean, open_time text, close_time text, open_days integer[]
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.seo_title, t.seo_description, t.business_type, t.service_areas, t.latitude, t.longitude,
    t.same_as, t.publish_hours, c.open_time, c.close_time, c.open_days
  FROM tenants t LEFT JOIN tenant_calendar c ON c.tenant_id = t.id
  WHERE t.id = p_tenant_id AND t.slug <> 'arkilaunch-platform';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_get_seo(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_get_seo(uuid) TO app_authenticated;--> statement-breakpoint

-- Public branding (0078) plus the SEO columns; hours only when the tenant chose to publish them.
DROP FUNCTION IF EXISTS catalog_get_tenant(text);--> statement-breakpoint
CREATE FUNCTION catalog_get_tenant(p_slug text)
RETURNS TABLE (
  name text, logo_key text, hero_key text, icon_key text, login_key text, primary_color text, header_color text,
  font text, tagline text, about text, phone text, contact_email text, address text, city text,
  province text, facebook_url text, messenger_url text,
  seo_title text, seo_description text, business_type text, service_areas text[], latitude numeric, longitude numeric,
  same_as text[], open_time text, close_time text, open_days integer[], content_updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.legal_name, t.logo_key, t.hero_key, t.icon_key, t.login_key, t.primary_color, t.header_color,
    t.font, t.tagline, t.about, t.phone, t.contact_email, t.address, t.city,
    t.province, t.facebook_url, t.messenger_url,
    t.seo_title, t.seo_description, t.business_type, t.service_areas, t.latitude, t.longitude,
    t.same_as,
    CASE WHEN t.publish_hours THEN c.open_time END,
    CASE WHEN t.publish_hours THEN c.close_time END,
    CASE WHEN t.publish_hours THEN c.open_days END,
    t.content_updated_at
  FROM tenants t LEFT JOIN tenant_calendar c ON c.tenant_id = t.id
  WHERE t.slug = p_slug AND t.status = 'active';
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_tenant(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_tenant(text) TO app_authenticated;--> statement-breakpoint

-- 0065's catalog functions plus updated_at: the later of the unit's content change and its current rate's start.
DROP FUNCTION IF EXISTS catalog_list_equipment(text);--> statement-breakpoint
CREATE FUNCTION catalog_list_equipment(p_slug text)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text,
  rate_type text, rate_value numeric, option_groups jsonb, photo_credit text, photo_source_url text,
  updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri, rc.rate_type, rc.rate_value,
    e.option_groups, e.photo_credit, e.photo_source_url,
    GREATEST(e.content_updated_at, rc.effective_from)
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  LEFT JOIN LATERAL (
    SELECT r.rate_type, r.rate_value, r.effective_from FROM rate_cards r
    WHERE r.tenant_id = e.tenant_id
      AND (r.equipment_id = e.id OR (r.equipment_id IS NULL AND r.equipment_type_id = e.equipment_type_id))
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (r.equipment_id IS NULL), (r.rate_type <> 'hourly'), r.effective_from DESC
    LIMIT 1
  ) rc ON true
  WHERE t.slug = p_slug AND t.status = 'active' AND e.retired_at IS NULL;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_list_equipment(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_list_equipment(text) TO app_authenticated;--> statement-breakpoint

DROP FUNCTION IF EXISTS catalog_get_equipment(text, uuid);--> statement-breakpoint
CREATE FUNCTION catalog_get_equipment(p_slug text, p_id uuid)
RETURNS TABLE (
  id uuid, equipment_type_name text, model text, availability_status text, photo_uri text,
  rate_type text, rate_value numeric, option_groups jsonb, photo_credit text, photo_source_url text,
  updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, et.name, e.model, e.availability_status, e.photo_uri, rc.rate_type, rc.rate_value,
    e.option_groups, e.photo_credit, e.photo_source_url,
    GREATEST(e.content_updated_at, rc.effective_from)
  FROM equipment e
  JOIN equipment_types et ON et.id = e.equipment_type_id
  JOIN tenants t ON t.id = e.tenant_id
  LEFT JOIN LATERAL (
    SELECT r.rate_type, r.rate_value, r.effective_from FROM rate_cards r
    WHERE r.tenant_id = e.tenant_id
      AND (r.equipment_id = e.id OR (r.equipment_id IS NULL AND r.equipment_type_id = e.equipment_type_id))
      AND r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY (r.equipment_id IS NULL), (r.rate_type <> 'hourly'), r.effective_from DESC
    LIMIT 1
  ) rc ON true
  WHERE t.slug = p_slug AND t.status = 'active' AND e.id = p_id
    AND e.retired_at IS NULL;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_get_equipment(text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_get_equipment(text, uuid) TO app_authenticated;
