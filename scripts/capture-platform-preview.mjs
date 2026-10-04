// Captures the actual inventory UI with local sample responses, never production data.
// Run with the web dev server up: node scripts/capture-platform-preview.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'https://almara.localhost:5173';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
  const payload = Buffer.from(JSON.stringify({ sub: 'sample-admin', tenant_id: 'sample-tenant', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const accessToken = `sample.${payload}.sample`;
  await page.addInitScript(() => {
    sessionStorage.setItem('arkilaunch.refreshToken', 'sample-only');
    sessionStorage.setItem('arkilaunch.tabUser', 'sample-admin');
    localStorage.setItem('arkilaunch.sessionOwner', 'sample-admin');
  });
  const groups = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Excavator', models: ['Hydraulic excavator', 'Tracked excavator', 'Compact excavator'] },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Backhoe loader', models: ['Backhoe loader', 'Tractor loader', 'Extendable backhoe'] },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Bulldozer', models: ['Crawler dozer', 'Compact dozer', 'Ripper dozer'] },
    { id: '44444444-4444-4444-8444-444444444444', name: 'Wheel loader', models: ['Wheel loader', 'Articulated loader', 'Compact loader'] },
    { id: '55555555-5555-4555-8555-555555555555', name: 'Motor grader', models: ['Motor grader', 'Compact grader', 'Road grader'] },
    { id: '66666666-6666-4666-8666-666666666666', name: 'Vibratory roller', models: ['Single drum roller', 'Tandem roller', 'Pneumatic roller'] },
  ];
  const items = groups.flatMap((group, groupIndex) => group.models.map((model, itemIndex) => ({
    id: `${String(groupIndex + 1).padStart(8, '0')}-1111-4111-8111-${String(itemIndex + 1).padStart(12, '0')}`,
    equipmentTypeId: group.id,
    equipmentTypeName: group.name,
    model,
    serialNo: `${String(group.name).slice(0, 2).toUpperCase()}-${String(itemIndex + 1).padStart(3, '0')}`,
    availabilityStatus: ['available', 'deployed', 'maintenance'][itemIndex],
    photoUrl: null,
    maintenanceIntervalHours: 250,
    accumulatedHours: 80,
  })));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path.endsWith('/auth/refresh')) body = { accessToken, refreshToken: 'sample-only' };
    else if (path.endsWith('/catalog/tenant')) body = { name: 'Sample rental company', slug: 'almara', primaryColor: null, headerColor: null, logoUrl: null, iconUrl: null, font: 'inter' };
    else if (path.endsWith('/users/me')) body = { id: 'sample-admin', name: 'Sample administrator', email: 'sample@example.com', tenantName: 'Sample rental company', role: 'admin' };
    else if (path.endsWith('/equipment/maintenance-windows/ending-soon')) body = [];
    else if (path.endsWith('/equipment')) body = { items, total: items.length, categories: groups.map(({ id: equipmentTypeId, name }) => ({ equipmentTypeId, name, count: 3 })) };
    else body = { items: [], total: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto(new URL('/app/inventory', origin).href);
  await page.getByRole('heading', { name: 'Equipment', exact: true }).first().waitFor();
  await page.getByRole('group', { name: 'VI-003', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(resolve('artifacts/platform-landing'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/platform-landing/inventory-source.png') });
  execFileSync('python', ['-c', "from pathlib import Path; from PIL import Image; out=Path('apps/web/public/images'); out.mkdir(exist_ok=True); img=Image.open('artifacts/platform-landing/inventory-source.png').convert('RGB'); img.save(out/'platform-inventory.webp', quality=84, method=6); img.resize((800,round(img.height*800/img.width)), Image.Resampling.LANCZOS).save(out/'platform-inventory-small.webp', quality=84, method=6)"]);
  console.log('Captured inventory UI and exported responsive WebP assets to apps/web/public/images. Requires Python Pillow.');
} finally {
  await browser.close();
}
