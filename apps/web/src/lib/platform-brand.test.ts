import { describe, expect, it } from 'vitest';
import { PLATFORM_TITLE, platformHeadTags } from './platform-brand.js';

describe('platform marketing metadata', () => {
  it('provides canonical and social metadata and factual software structured data', () => {
    const html = platformHeadTags('https://arkilaunch.app');
    const doc = new DOMParser().parseFromString(`<head>${html}</head>`, 'text/html');
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://arkilaunch.app/');
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(PLATFORM_TITLE);
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://arkilaunch.app/images/platform-dashboard.webp');
    const data = JSON.parse(doc.querySelector('script')!.textContent!);
    expect(data['@graph'].map((item: { '@type': string }) => item['@type'])).toEqual(['Organization', 'SoftwareApplication']);
    expect(html).not.toMatch(/aggregateRating|offers|review/);
  });

  it('escapes host-derived text in both attributes and JSON-LD', () => {
    const html = platformHeadTags('https://example.test/"<script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&lt;script&gt;');
    expect(html).toContain('\\u003cscript>');
  });
});
