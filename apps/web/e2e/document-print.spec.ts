import { test, expect, type Page } from '@playwright/test';

// Every API request is fulfilled locally. These print fixtures never access a
// seeded database, create a payment, or send an email.
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const rentalId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const quoteId = '55555555-5555-4555-8555-555555555555';
const companyName = 'Ñandú Hernández Construction & Engineering – São José Project Services';
const address = 'Unit 208, Señora María Building, 123 Mahabang Pangalan Avenue, Barangay San José, Quezon City, Metro Manila 1100, Philippines';
const description = 'Excavator rental – reinforced foundation works, São José access road; inspection, operator coordination and documented equipment support.';
const brands = [
  { key: 'inter', name: 'Almara Print QA', primaryColor: '#176b52', font: 'inter', logoWidth: 480, logoHeight: 100 },
  { key: 'plex', name: 'Copper Print QA', primaryColor: '#9b451d', font: 'plex', logoWidth: 100, logoHeight: 280 },
] as const;
type Brand = typeof brands[number];
type Kind = 'invoice' | 'soa' | 'quotation';
const total = 43758.75;
const lines = Array.from({ length: 35 }, (_, index) => ({
  id: `66000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  description: `${String(index + 1).padStart(2, '0')}. ${description}`,
  quantity: 1, unitPrice: 1250.25, amount: 1250.25,
}));

function token(role: 'customer' | 'owner') {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId, tenantId, role, exp: Math.floor(Date.now() / 1000) + 3600 })}.print-qa`;
}

async function fixture(page: Page, brand: Brand, role: 'customer' | 'owner') {
  await page.addInitScript(({ userId }) => {
    sessionStorage.setItem('arkilaunch.refreshToken', 'qa-print-refresh');
    sessionStorage.setItem('arkilaunch.tabUser', userId);
    sessionStorage.setItem('setup-modal-seen', '1');
    localStorage.setItem('arkilaunch.sessionOwner', userId);
  }, { userId });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${brand.logoWidth}" height="${brand.logoHeight}" viewBox="0 0 ${brand.logoWidth} ${brand.logoHeight}"><rect width="100%" height="100%" fill="${brand.primaryColor}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="48" font-family="sans-serif">QA</text></svg>`;
  const logoUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    if (request.method() === 'OPTIONS') return reply({});
    if (path === '/auth/refresh') return reply({ accessToken: token(role), refreshToken: 'qa-print-refresh' });
    if (path === '/catalog/tenant') return reply({ ...brand, logoUrl, slug: 'almara', address: '24 Yard Road', city: 'Pasig', province: 'Metro Manila', phone: '+63 917 123 4567', contactEmail: 'print-qa@example.test' });
    if (path === '/users/me') return reply({ id: userId, tenantId, role, name: 'Print QA', email: 'print@example.test', tenantName: brand.name, tenantTin: '123-456-789-000' });
    if (path === '/me/companies') return reply([{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', companyName, kycStatus: 'approved' }]);
    if (path === `/me/invoices/${invoiceId}`) return reply({
      id: invoiceId, rentalId, truckRequestId: null, bookingCode: 'EQR-QA-PRINT-0001', invoiceType: 'weekly', amount: total, status: 'issued',
      createdAt: '2026-10-01T00:00:00Z', dueDate: '2026-10-08T00:00:00Z', lineItems: lines,
      billTo: { companyName, tin: '987-654-321-000', billingAddress: address }, edtrEvidence: null, receiptNo: null, auditTrail: [],
    });
    if (path === `/me/rentals/${rentalId}/statement`) return reply({
      rentalId, bookingCode: 'EQR-QA-PRINT-0001', status: 'completed', rentalStart: '2026-01-05T00:00:00Z', rentalEnd: '2026-10-02T00:00:00Z',
      company: { name: companyName, tin: '987-654-321-000', billingAddress: address },
      weeks: Array.from({ length: 35 }, (_, index) => {
        const start = new Date(Date.UTC(2026, 0, 5 + index * 7)).toISOString().slice(0, 10);
        const end = new Date(Date.UTC(2026, 0, 11 + index * 7)).toISOString().slice(0, 10);
        return { weekStart: start, weekEnd: end, hours: 8, amount: 1250.25, fromDeposit: 0, invoiced: 1250.25, unbilled: 0, customerPays: 1250.25, paid: 0, outstanding: 1250.25 };
      }),
      invoices: lines.map((line) => ({ id: line.id, invoiceType: 'weekly', amount: line.amount, status: 'issued', createdAt: '2026-10-01T00:00:00Z', dueDate: '2026-10-08T00:00:00Z' })),
      payments: [], deposit: { required: 5000, deducted: 0, remaining: 5000 }, totals: { charged: total, paid: 0, unbilled: 0, balanceDue: total }, generatedAt: '2026-10-20T00:00:00Z',
    });
    if (path === `/quotes/${quoteId}`) return reply({
      id: quoteId, revision: 2, status: 'approved', customerName: companyName, bookingCode: 'EQR-QA-PRINT-0001', createdAt: '2026-10-01T00:00:00Z',
      dieselPrice: 58.25, dieselPriceDate: '2026-10-01', subtotal: total, total, discount: 0, mobilization: 0, demobilization: 0,
      lineItems: lines.map((line) => ({ kind: 'custom', description: line.description, quantity: 1, subtotal: line.amount, rentParts: [] })),
    });
    if (path.includes('/events')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    return reply({ items: [], total: 0, unreadCount: 0 });
  });
}

for (const brand of brands) {
  for (const kind of ['invoice', 'soa', 'quotation'] as const) {
    test(`${kind} browser print keeps long content and ${brand.key} tenant branding`, async ({ page }) => {
      await page.setViewportSize({ width: 794, height: 1123 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fixture(page, brand, kind === 'quotation' ? 'owner' : 'customer');
      const path: Record<Kind, string> = { invoice: `/account/invoices/${invoiceId}`, soa: `/account/bookings/${rentalId}/statement`, quotation: `/app/quotes/${quoteId}/print` };
      await page.goto(path[kind]);
      if (kind === 'invoice') await expect(page.getByRole('heading', { name: 'Billing statement' })).toBeVisible();
      else if (kind === 'soa') await expect(page.getByRole('heading', { name: 'Hours by week' })).toBeVisible();
      else await expect(page.getByLabel('Quote line items')).toBeVisible();
      await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
      const head = page.locator('[data-print-letterhead]');
      await expect(head).toBeVisible();
      await expect(head).toContainText(brand.name);
      await expect(head).toContainText(companyName);
      await expect(page.locator('[data-print-footer]')).toHaveText(brand.name);
      if (kind !== 'quotation') await expect(head).toContainText(address);
      await expect(head).toHaveCSS('border-bottom-color', brand.key === 'inter' ? 'rgb(23, 107, 82)' : 'rgb(155, 69, 29)');
      await expect(page.locator('button:visible')).toHaveCount(0);
      await expect(page.locator('[data-print-hide]:visible')).toHaveCount(0);
      await expect(page.locator('nav:visible')).toHaveCount(0);
      await expect(page.locator('main')).toContainText('43,758.75');
      if (kind !== 'soa') {
        await expect(page.locator('main')).toContainText(lines[0]!.description);
        await expect(page.locator('main')).toContainText(lines[34]!.description);
      }
      const logo = head.locator('img');
      await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      const box = await logo.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(160);
      expect(box!.height).toBeLessThanOrEqual(56);
      expect(await page.evaluate(() => [...document.querySelectorAll('main table')].every((table) => table.scrollWidth <= table.clientWidth + 1))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({ path: `artifacts/rental-qa/print-${kind}-${brand.key}.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.screenshot({ path: `artifacts/rental-qa/print-${kind}-${brand.key}.png`, fullPage: true });
    });
  }
}

test('a single quotation line prints on one letter page', async ({ page }) => {
  await fixture(page, brands[0], 'owner');
  await page.route('**/api/v1/quotes/' + quoteId, route => route.fulfill({ json: {
    id: quoteId, revision: 1, status: 'approved', customerName: companyName, bookingCode: 'EQR-QA-PRINT-0001',
    createdAt: '2026-11-25T00:00:00Z', dieselPrice: 58, dieselPriceDate: '2026-11-25', subtotal: 1200,
    total: 1200, discount: 0, mobilization: 0, demobilization: 0,
    lineItems: [{ kind: 'custom', description: 'Equipment transport', quantity: 1, subtotal: 1200 }],
  } }));
  await page.goto('/app/quotes/' + quoteId + '/print');
  await expect(page.getByText('Equipment transport', { exact: false })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const { PDFDocument } = await import('pdf-lib');
  const document = await PDFDocument.load(await page.pdf({ format: 'Letter', printBackground: true }));
  expect(document.getPageCount()).toBe(1);
});
