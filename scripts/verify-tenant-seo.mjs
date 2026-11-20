// Run Wrangler dev with --var PLATFORM_DOMAIN:localhost (no --host: it rewrites the tenant hostname away), API reachable.
import assert from 'node:assert/strict';
const tenant = 'http://almara.localhost:8787';
const get = (url, ua = 'GPTBot') => fetch(url, { headers: { 'User-Agent': ua }, redirect: 'manual' });

const home = await get(`${tenant}/`);
assert.equal(home.status, 200);
const html = await home.text();
assert.match(html, /content="index, follow"/);
assert.match(html, /"@type":"LocalBusiness"/);
assert.match(html, /og:locale/);

for (const path of ['/equipment/not-a-uuid', '/equipment/00000000-0000-4000-8000-000000000000', '/nope', '/wp-login.php']) {
  const res = await get(`${tenant}${path}`);
  assert.equal(res.status, 404, path);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex', path);
}
const ghost = await get('http://zzz-no-such-tenant.localhost:8787/');
assert.equal(ghost.status, 404);

const robots = await (await get(`${tenant}/robots.txt`)).text();
assert.match(robots, /User-agent: GPTBot\n[\s\S]*Allow: \/\n/);
assert.match(robots, /Disallow: \/app\//);
assert.match(robots, /Sitemap: http:\/\/almara\.localhost:8787\/sitemap\.xml/);

const sitemap = await (await get(`${tenant}/sitemap.xml`)).text();
assert.match(sitemap, /<urlset/);
assert.equal((await get('http://zzz-no-such-tenant.localhost:8787/sitemap.xml')).status, 404);

console.log('Tenant SEO passed: indexed home with LocalBusiness, real 404s, open robots, tenant sitemap.');

const body = /<div id="root">([\s\S]*?)<\/div>\s*<\/body>/.exec(html)?.[1] ?? '';
assert.match(body, /<h1>/, 'home snapshot has an h1');
assert.match(body, /href="\/equipment"/, 'home snapshot links the catalog');
assert.match(html, /id="catalog-seed"/);
const llms = await get(`${tenant}/llms.txt`);
assert.equal(llms.status, 200);
assert.match(await llms.text(), /^# /);
console.log('Tenant snapshot passed: #root carries content and the seed; /llms.txt served.');
