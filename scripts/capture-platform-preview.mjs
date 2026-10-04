// Captures the actual dashboard UI with local sample responses, never production data.
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
  const fleet = items.slice(0, 6).map(({ id, model, serialNo, equipmentTypeId, availabilityStatus }) => ({ id, model, serialNo, equipmentTypeId, availabilityStatus }));
  const sites = [
    { id: '77777777-7777-4777-8777-777777777777', latitude: 14.5995, longitude: 120.9842, latestSeverity: 'none', city: 'Manila', province: 'Metro Manila', observedAt: '2026-10-04T08:30:00.000Z', activeUnits: 3, upcomingUnits: 1, nextArrival: '2026-10-05T00:00:00.000Z', customerName: 'Sample Construction' },
    { id: '88888888-8888-4888-8888-888888888888', latitude: 14.5547, longitude: 121.0244, latestSeverity: 'watch', city: 'Makati', province: 'Metro Manila', observedAt: '2026-10-04T08:15:00.000Z', activeUnits: 2, upcomingUnits: 0, nextArrival: null, customerName: 'Sample Builders' },
  ];
  const reviewItems = [
    { id: '99999999-9999-4999-8999-999999999991', equipmentId: items[0].id, reportDate: '2026-10-02' },
    { id: '99999999-9999-4999-8999-999999999992', equipmentId: items[1].id, reportDate: '2026-10-02' },
    { id: '99999999-9999-4999-8999-999999999993', equipmentId: items[3].id, reportDate: '2026-10-01' },
  ];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body;
    if (path.endsWith('/auth/refresh')) body = { accessToken, refreshToken: 'sample-only' };
    else if (path.endsWith('/catalog/tenant')) body = { name: 'Sample rental company', slug: 'almara', primaryColor: null, headerColor: null, logoUrl: null, iconUrl: null, font: 'inter' };
    else if (path.endsWith('/users/me')) body = { id: 'sample-admin', name: 'Sample administrator', email: 'sample@example.com', tenantName: 'Sample rental company', role: 'admin' };
    else if (path.endsWith('/reports/utilization')) body = { period: { from: '2026-09-01', to: '2026-09-30' }, fleet: fleet.map((equipment, index) => ({ equipmentId: equipment.id, runtimeHours: [112, 94, 86, 78, 71, 64][index], utilizationPct: [92, 86, 81, 77, 70, 65][index], maintenanceDue: index === 2 })) };
    else if (path.endsWith('/reports/financial')) body = { period: { from: '2026-09-01', to: '2026-09-30' }, invoiced: { byType: { rental: 410000, booking: 60000 }, total: 470000 }, paid: 312000, depositDeducted: 0 };
    else if (path.endsWith('/sites')) body = { items: sites, total: 7 };
    else if (path.endsWith('/weather/advisories')) body = { items: [], total: 0 };
    else if (path.endsWith('/edtr')) body = url.searchParams.has('limit') ? { total: reviewItems.length } : { items: reviewItems, total: reviewItems.length };
    else if (path.endsWith('/truck-requests')) body = { items: [], total: 2 };
    else if (path.endsWith('/customers/review')) body = { items: [], total: 3 };
    else if (path.endsWith('/invoices')) body = { items: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', rentalId: null, truckRequestId: null, bookingCode: 'RNT-2409', invoiceType: 'rental', amount: 84500, status: 'issued', dueDate: '2026-10-10T00:00:00.000Z', createdAt: '2026-10-01T08:00:00.000Z' },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', rentalId: null, truckRequestId: null, bookingCode: 'RNT-2412', invoiceType: 'booking', amount: 56000, status: 'issued', dueDate: '2026-10-12T00:00:00.000Z', createdAt: '2026-10-02T08:00:00.000Z' },
    ], total: 2 };
    else if (path.endsWith('/incidents')) body = { items: [], total: 0 };
    else if (path.endsWith('/reference/equipment')) body = fleet;
    else if (path.endsWith('/notifications')) body = { items: [], total: 0 };
    else body = { items: [], total: 0 };
    await route.fulfill({ json: body });
  });
  await page.goto(new URL('/app', origin).href);
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.getByText('Invoiced', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(resolve('artifacts/platform-landing'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/platform-landing/dashboard-source.png') });
  execFileSync('python', ['-c', "from pathlib import Path; from PIL import Image; out=Path('apps/web/public/images'); out.mkdir(exist_ok=True); img=Image.open('artifacts/platform-landing/dashboard-source.png').convert('RGB'); img.save(out/'platform-dashboard.webp', quality=86, method=6); img.resize((800,round(img.height*800/img.width)), Image.Resampling.LANCZOS).save(out/'platform-dashboard-small.webp', quality=86, method=6)"]);
  console.log('Captured dashboard UI and exported responsive WebP assets to apps/web/public/images. Requires Python Pillow.');
} finally {
  await browser.close();
}
