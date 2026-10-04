// Run Wrangler dev with --var PLATFORM_DOMAIN:localhost --host localhost --upstream-protocol http.
import assert from 'node:assert/strict';
const origin = 'http://localhost:8787';
const htmlFor = async (path) => {
  const res = await fetch(`${origin}${path}`);
  assert.equal(res.status, 200);
  return res.text();
};
const home = await htmlFor('/?q=Almara');
assert.match(home, /<title>ArkiLaunch \| Equipment rental management software<\/title>/);
assert.match(home, /content="index, follow"/);
assert.match(home, /rel="canonical" href="http:\/\/localhost\/"/);
assert.match(home, /SoftwareApplication/);
assert.match(home, /og:image/);
for (const path of ['/register', '/login', '/app/inventory', '/privacy']) {
  const html = await htmlFor(path);
  assert.match(html, /noindex, nofollow/);
  assert.doesNotMatch(html, /SoftwareApplication/);
}
console.log('Worker SEO passed: homepage indexed with canonical metadata; private/resource routes remain noindex.');
