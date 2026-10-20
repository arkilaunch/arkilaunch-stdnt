import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({page}) => { await page.emulateMedia({reducedMotion:'reduce'}); });

// Browser-only fixtures: intercept every API request before navigation. No seed,
// database, real authentication, payment provider, or remote write is required.
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bookingId = '33333333-3333-4333-8333-333333333333';
const companyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const agreementText = 'QA stored rental agreement. Equipment remains the property of the rental company. Document damage, inspect returned equipment, and obtain an agreed repair estimate before proposing liability.';
const brands = [
  { name: 'Almara QA Rentals', primaryColor: '#176b52', font: 'inter', amount: 820.25, qualification: 'Selected machines, eight-hour minimum.' },
  { name: 'Copper QA Equipment', primaryColor: '#9b451d', font: 'plex', amount: 960.50, qualification: 'Selected equipment on approved local projects.' },
] as const;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId, tenantId, tenant_id: tenantId, role: 'customer', exp: Math.floor(Date.now() / 1000) + 3600 })}.qa-fixture`;
}

async function mockApi(page: Page, brand: typeof brands[number] = brands[0], authenticated = false) {
  const checkout: Record<string, unknown>[] = [];
  if (authenticated) await page.addInitScript(({ userId }) => {
    sessionStorage.setItem('arkilaunch.refreshToken', 'qa-local-refresh');
    sessionStorage.setItem('arkilaunch.tabUser', userId);
    sessionStorage.setItem('setup-modal-seen', '1');
    localStorage.setItem('arkilaunch.sessionOwner', userId);
  }, { userId });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    if (request.method() === 'OPTIONS') return reply({});
    if (path === '/auth/refresh') return reply({ accessToken: token(), refreshToken: 'qa-local-refresh' });
    if (path === '/catalog/tenant') return reply({ ...brand, slug: 'almara', tagline: 'Reliable equipment for your next project.', about: 'A tenant-branded fleet and transport team.', phone: null, contactEmail: 'qa@example.test', logoUrl: null, heroUrl: null, iconUrl: null });
    if (path === '/catalog/promotions') return reply({ equipment: { enabled: true, amount: brand.amount, unit: 'hour', qualification: brand.qualification }, trucking: { enabled: true, amount: 2500, unit: 'trip', qualification: 'Local trips; route and load limits apply.' } });
    if (path === '/catalog/testimonials') return reply({ items: [] });
    if (path === '/catalog/equipment') return reply({ items: [{ id: '44444444-4444-4444-8444-444444444444', model: 'QA excavator', equipmentTypeName: 'Excavator', availabilityStatus: 'available', rateValue: 9876.54, photoUri: null }] });
    if (path === '/users/me') return reply({ id: userId, tenantId, role: 'customer', name: 'QA Customer', email: 'customer@example.test', tenantName: brand.name });
    if (path === '/me/companies') return reply([{ id: companyId, companyName: 'QA Construction', kycStatus: 'approved' }]);
    if (path === '/bookings/rental-terms') return reply({ version: 'qa-v1', body: agreementText, isDefault: false });
    if (path === `/bookings/${bookingId}`) return reply({
      id: bookingId, code: 'EQR-QA-0001', status: 'pending', customerId: companyId, projectSiteId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      siteCity: 'Pasig', siteProvince: 'Metro Manila', siteContact: 'QA Site Contact', siteNotes: null, trackerUrl: `/orders/${bookingId}`,
      items: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', equipmentId: '44444444-4444-4444-8444-444444444444', equipmentName: 'QA excavator', start: '2026-11-01T00:00:00Z', end: '2026-11-03T09:00:00Z', status: 'scheduled', returnConditionNotes: null, returnNeedsRepair: false }],
      invoices: [], payments: [], changeRequests: [], agreement: null, callConfirmedAt: '2026-10-19T00:00:00Z', callRequestedAt: null, createdAt: '2026-10-19T00:00:00Z',
      quotation: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', revision: 1, status: 'accepted', totalPhp: 15000, mobilizationPhp: 1000, demobilizationPhp: 1000, createdAt: '2026-10-19T00:00:00Z' },
      deposit: { required: 5000, totalDeducted: 0, deductions: [] },
    });
    if (path === `/bookings/${bookingId}/checkout`) {
      checkout.push(request.postDataJSON());
      return reply({ error: 'payment_provider_unavailable' }, 502);
    }
    if (path.includes('notification')) return reply({ items: [], total: 0, unreadCount: 0 });
    if (path.includes('/events')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    return reply({ items: [], total: 0 });
  });
  return checkout;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [360, 1440]) {
  test(`agreement stays in a modal, preserves drafts, and gates payment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const checkout = await mockApi(page, brands[0], true);
    await page.goto(`/account/checkout/${bookingId}`);
    const review = page.getByRole('button', { name: 'Review and sign', exact: true });
    await expect(review).toBeVisible();
    await expect(page.getByText(agreementText, { exact: true })).toHaveCount(0);
    const pay = page.getByRole('button', { name: 'Pay now', exact: true });
    await expect(pay).toBeDisabled();
    await noOverflow(page);
    await page.screenshot({ path: `artifacts/rental-qa/checkout-compact-${width}.png`, fullPage: true });
    await review.click();
    const dialog = page.getByRole('dialog', { name: 'Review and sign rental agreement' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Rental agreement text')).toHaveText(agreementText);
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await dialog.getByLabel('Full name', { exact: true }).fill('QA Customer');
    await dialog.getByRole('checkbox', { name: /agree to this rental agreement/ }).check();
    await expect(dialog.getByRole('button', { name: 'Confirm signature' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Use my typed name as signature' }).click();
    await expect(pay).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(pay).toBeDisabled();
    await review.click();
    await expect(dialog.getByLabel('Full name', { exact: true })).toHaveValue('QA Customer');
    await expect(dialog.getByRole('checkbox')).toBeChecked();
    await expect(dialog.getByRole('img', { name: 'Your signature', exact: true })).toBeVisible();
    await noOverflow(page);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/rental-qa/agreement-modal-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Confirm signature' }).click();
    await expect(dialog).toBeHidden();
    await expect(pay).toBeEnabled();
    await page.getByRole('button', { name: 'Review signature', exact: true }).click();
    await expect(dialog.getByLabel('Full name', { exact: true })).toHaveValue('QA Customer');
    await dialog.getByRole('button', { name: 'Confirm signature' }).click();
    await pay.click();
    await expect(page.getByRole('alert').filter({ hasText: 'The payment provider is unavailable' })).toBeVisible();
    expect(checkout).toHaveLength(1);
    expect(checkout[0]).toMatchObject({ method: 'qrph', agreement: { signedName: 'QA Customer', termsVersion: 'qa-v1' } });
    expect((checkout[0]!.agreement as { signaturePng: string }).signaturePng).toMatch(/^data:image\/png;base64,/);
    await noOverflow(page);
  });

  for (const brand of brands) {
    test(`tenant ${brand.font} storefront promotes qualified starting prices at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockApi(page, brand);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'The right equipment. The transport to match.' })).toBeVisible();
      await expect(page.getByText(brand.qualification, { exact: true })).toBeVisible();
      await expect(page.getByText('As low as', { exact: true })).toHaveCount(2);
      await expect(page.getByText('Final price confirmed in quote.', { exact: true })).toHaveCount(2);
      await expect(page.getByText('QA excavator', { exact: true })).toBeVisible();
      await expect(page.getByTestId('equipment-card-price')).toHaveCount(0);
      await expect(page.getByText(/9,876\.54/)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Request trucking', exact: true })).toHaveAttribute('href', '/account/trucks');
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--yb-color-primary'))).toBe(brand.primaryColor);
      await noOverflow(page);
      await page.screenshot({ path: `artifacts/rental-qa/storefront-${brand.font}-${width}.png`, fullPage: true });
    });
  }
}
