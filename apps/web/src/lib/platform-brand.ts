// Shared by the browser and edge Worker.
export const PLATFORM_TITLE = 'ArkiLaunch | Equipment rental management software';
export const PLATFORM_DESCRIPTION = 'Manage your equipment fleet, quotations, dispatch, field timesheets and billing in one place. Launch your rental company storefront with ArkiLaunch.';

// The platform's own pages plus every active storefront's sitemap. Cross-host entries count once the platform domain
// is a verified Search Console Domain property (docs/runbook-search-console.md).
export function sitemapIndexXml(locs: string[]): string {
  const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = locs.map((loc) => `  <sitemap><loc>${xml(loc)}</loc></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

export function platformHeadTags(origin: string): string {
  const canonical = `${origin}/`;
  const image = `${origin}/images/platform-dashboard.webp`;
  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'ArkiLaunch', url: canonical },
      { '@type': 'SoftwareApplication', name: 'ArkiLaunch', url: canonical, applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser', description: PLATFORM_DESCRIPTION },
    ],
  };
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    `<meta name="description" content="${escape(PLATFORM_DESCRIPTION)}" />`,
    `<link rel="canonical" href="${escape(canonical)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="ArkiLaunch" />',
    `<meta property="og:title" content="${escape(PLATFORM_TITLE)}" />`,
    `<meta property="og:description" content="${escape(PLATFORM_DESCRIPTION)}" />`,
    `<meta property="og:url" content="${escape(canonical)}" />`,
    `<meta property="og:image" content="${escape(image)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escape(PLATFORM_TITLE)}" />`,
    `<meta name="twitter:description" content="${escape(PLATFORM_DESCRIPTION)}" />`,
    `<meta name="twitter:image" content="${escape(image)}" />`,
    `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script>`,
  ].join('\n').replace(/<(meta|link|script)\b/g, '<$1 data-platform-seo');
}
