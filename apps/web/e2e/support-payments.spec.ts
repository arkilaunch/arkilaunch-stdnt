import { test, expect as baseExpect, type Page } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 30_000 });

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 30_000 });
test.beforeEach(() => { test.setTimeout(180_000); });

async function signInAt(page: Page, staff = false) {
  await page.addInitScript(() => sessionStorage.setItem('setup-modal-seen', '1'));
  await page.goto('/login');
  await page.getByLabel('Email').fill(staff ? 'admin@admin.com' : 'customer@admin.com');
  await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'admin');
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await loginResponse;
  const tokens = await response.json();
  expect(response.ok(), `Sign-in status ${response.status()}, error ${String(tokens.error ?? 'none')}`).toBe(true);
  await expect(page).toHaveURL(staff ? /\/app/ : /\/account/, { timeout: 60_000 });
  return tokens as { accessToken: string };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

for (const width of [360, 375, 390, 393, 430, 1440]) {
  test(`QR Ph and support workflow at ${width}px`, async ({ page, browser }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 850 });
    const tokens = await signInAt(page);
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };
    const list = await page.request.get('/api/v1/bookings?limit=10&offset=0', { headers });
    expect(list.ok()).toBe(true);
    const bookingId = (await list.json()).items[0].id as string;
    // Exercise rejection at the real API boundary, before any checkout preconditions.
    // Once per run, not per width: the API throttles at 120 requests a minute.
    for (const method of width === 360 ? ['gcash', 'paymaya', 'dob', 'card'] : []) {
      const rejected = await page.request.post(`/api/v1/bookings/${bookingId}/checkout`, { headers, data: { method } });
      expect(rejected.status()).toBe(400);
    }
    expect((await page.request.get('/api/v1/tickets', { headers })).status()).toBe(403);
    // UI-only fixture opens checkout controls without changing a booking or creating a provider session.
    const realDetail = await page.request.get(`/api/v1/bookings/${bookingId}`, { headers });
    expect(realDetail.ok()).toBe(true);
    const booking = await realDetail.json();
    booking.callConfirmedAt = new Date().toISOString();
    booking.agreement = {
      signedName: 'QA Customer', signedAt: booking.callConfirmedAt, termsVersion: 'v1',
      signaturePng: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=',
    };
    if (booking.quotation) booking.quotation.status = 'accepted';
    await page.route(`**/api/v1/bookings/${bookingId}`, (route) => route.fulfill({ json: booking }));
    let chosenMethod: string | undefined;
    await page.route(`**/api/v1/bookings/${bookingId}/checkout`, async (route) => {
      chosenMethod = route.request().postDataJSON().method;
      await route.fulfill({ status: 502, json: { error: 'payment_provider_rejected' } });
    });
    await page.goto(`/account/checkout/${bookingId}`);
    await expect(page.getByText('QR Ph', { exact: true })).toBeVisible({ timeout: 30_000 });
    for (const name of ['GCash', 'Maya', 'Online banking', 'Credit or debit card']) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Cash, bank deposit or company cheque', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pay now', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The payment provider could not start QR Ph' })).toBeVisible();
    expect(chosenMethod).toBe('qrph');
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`checkout-${width}.png`), fullPage: true });
    await page.unroute(`**/api/v1/bookings/${bookingId}`);
    await page.goto(`/account/checkout/failed?booking=${bookingId}`);
    const help = page.getByRole('link', { name: 'Get help' });
    await expect(help).toHaveAttribute('href', `/account/help?booking=${bookingId}`);
    await help.click();
    await expect(page).toHaveURL(new RegExp(`/account/help\\?booking=${bookingId}`));
    await expect(page.getByRole('combobox', { name: 'Category' })).toHaveText(/Payment/);
    await page.getByRole('button', { name: 'Submit ticket' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Subject' })).toBeVisible();
    const subject = `Payment QA ${info.project.name} ${width} ${Date.now()}`;
    await page.getByLabel(/^Subject/).fill(subject);
    await page.getByLabel('Message details').fill('Please help with my QR Ph payment. <script>plain text</script>\n' + 'Payment detail for review. '.repeat(100));
    const create = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/tickets') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit ticket' }).click();
    const response = await create;
    expect(response.status()).toBe(201);
    const ticket = await response.json();
    expect(ticket.bookingId).toBe(bookingId);
    expect(ticket.category).toBe('payment');
    await expect(page.getByRole('status').filter({ hasText: `Ticket #${ticket.code} submitted` })).toBeVisible();
    const ownTicket = page.getByRole('listitem').filter({ hasText: subject });
    await expect(ownTicket).toContainText(`#${ticket.code}`);
    await expect(ownTicket).toContainText('Open');
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`help-${width}.png`), fullPage: true });

    const staffContext = await browser.newContext({ baseURL: info.project.use.baseURL as string, ignoreHTTPSErrors: true, viewport: { width, height: width === 1440 ? 900 : 850 } });
    try {
      const staff = await staffContext.newPage();
      await signInAt(staff, true);
      await staff.goto('/app/tickets');
      await staff.getByLabel('Search by subject or ID').fill(subject);
      const row = width < 768 ? staff.getByRole('listitem').filter({ hasText: subject }) : staff.getByRole('row').filter({ hasText: subject });
      await expect(row).toContainText(`#${ticket.code}`);
      await row.getByRole('button', { name: 'View', exact: true }).click();
      await expect(staff.getByRole('dialog')).toContainText('<script>plain text</script>');
      await staff.getByRole('button', { name: 'Close', exact: true }).click();
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      const modal = staff.getByRole('dialog');
      await modal.getByRole('combobox', { name: 'Status', exact: true }).click();
      await staff.getByRole('option', { name: 'In progress', exact: true }).click();
      await expect(modal.getByRole('button', { name: 'Save changes' })).toBeEnabled();
      await noOverflow(staff);
      const box = await modal.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await staff.screenshot({ path: info.outputPath(`edit-${width}.png`), fullPage: true });
      await modal.getByRole('button', { name: 'Save changes' }).click();
      await expect(modal).toBeHidden();
      await expect(row).toContainText('In progress');
      await staff.getByRole('combobox', { name: 'Filter status' }).click();
      await staff.getByRole('option', { name: 'In progress', exact: true }).click();
      await expect(row).toBeVisible();
      await noOverflow(staff);
      await staff.screenshot({ path: info.outputPath(`tickets-${width}.png`), fullPage: true });
      await page.reload();
      await expect(page.getByRole('listitem').filter({ hasText: subject })).toContainText('In progress');
      await row.getByRole('button', { name: 'Resolve', exact: true }).click();
      await expect(row).toBeHidden();
      await page.reload();
      await expect(page.getByRole('listitem').filter({ hasText: subject })).toContainText('Resolved');
      await page.goto('/account/help?booking=invalid');
      await expect(page.getByRole('combobox', { name: 'Category' })).toHaveText(/Booking Equipment/);
      await expect(page.getByText('Booking attached:', { exact: false })).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/account/help\\?booking=${bookingId}`));
    } finally { await staffContext.close(); }
  });
}
