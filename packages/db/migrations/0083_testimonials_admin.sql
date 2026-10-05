ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS headline text;
--> statement-breakpoint
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON testimonials TO app_authenticated;
--> statement-breakpoint
DROP FUNCTION catalog_list_testimonials(text);
CREATE FUNCTION catalog_list_testimonials(p_slug text)
RETURNS TABLE (id uuid, quote text, author_name text, author_title text, headline text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.id, tm.quote, tm.author_name, tm.author_title, tm.headline
  FROM testimonials tm JOIN tenants t ON t.id = tm.tenant_id
  WHERE t.slug = p_slug AND t.status = 'active'
  ORDER BY tm.created_at DESC, tm.id;
$$;
REVOKE ALL ON FUNCTION catalog_list_testimonials(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_list_testimonials(text) TO app_authenticated;
