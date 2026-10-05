import { test, expect, type Page } from '@playwright/test';
import { signIn, TENANT_HEADERS } from './sign-in.js';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
async function openMenu(page: Page) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
}

for (const width of [360, 375, 390, 430, 1440]) {
  test(`staff manages a testimonial and the public navigation reaches it at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto('/app/branding');
    // Surface uses a div, so scope through its accessible label.
    const area = page.locator('[aria-label="Testimonials"]');
    const headline = `QA fixture ${Date.now()} ${info.project.name}`;
    await area.getByLabel('Headline', { exact: true }).fill(headline);
    await area
      .getByLabel('Quote', { exact: true })
      .fill('QA fixture text for local browser verification.');
    await area.getByRole('textbox', { name: /Author name/ }).fill('QA Fixture');
    await area.getByLabel('Author title', { exact: true }).fill('Local test');
    await area.getByRole('button', { name: 'Add testimonial', exact: true }).click();
    const row = area.getByRole('listitem').filter({ hasText: headline });
    await expect(row).toBeVisible();
    await noOverflow(page);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await area.getByLabel('Quote', { exact: true }).fill('x'.repeat(280));
    await area.getByRole('button', { name: 'Save testimonial', exact: true }).click();
    await expect(row).toContainText('x'.repeat(280));
    await page.screenshot({
      path: `test-results/pa-settings-${info.project.name}-${width}.png`,
      fullPage: true,
    });
    await page.goto('/');
    await expect(
      page.locator('#testimonials').getByRole('heading', { name: headline }),
    ).toBeVisible();
    await expect(page.getByTestId('equipment-card-price')).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/pa-testimonials-${info.project.name}-${width}.png`,
      fullPage: true,
    });
    await openMenu(page);
    await page.getByRole('link', { name: 'Testimonials', exact: true }).click();
    await expect(page).toHaveURL(/#testimonials$/);
    await expect(page.locator('#testimonials')).toBeInViewport();
    await page.goto('/app/branding');
    await area
      .getByRole('listitem')
      .filter({ hasText: headline })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(area.getByRole('listitem').filter({ hasText: headline })).toBeVisible();
    await area
      .getByRole('listitem')
      .filter({ hasText: headline })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete testimonial', exact: true })
      .click();
    await expect(area.getByRole('listitem').filter({ hasText: headline })).toHaveCount(0);
  });
}

test('landing and signed-out cart work at each required width', async ({ page }, info) => {
  test.setTimeout(90_000);
  for (const width of [360, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Available equipment' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rent', exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('equipment-card-price')).toHaveCount(0);
    await expect(page.getByText(/\/ hour|Price on request/)).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/pa-landing-${info.project.name}-${width}.png`,
      fullPage: true,
    });
    if (width < 640) {
      await openMenu(page);
      const cart = page.getByRole('link', { name: 'Cart', exact: true });
      await expect(cart).toBeVisible();
      expect((await cart.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await cart.click();
      await expect.soft(page).toHaveURL(/\/account\/cart$/);
      await noOverflow(page);
    }
  }
  await page.goto('/equipment');
  await expect(page.getByTestId('equipment-card-price').first()).toContainText('/ hour');
});

test('empty testimonials hide the section and navigation', async ({ page }) => {
  await page.route('**/catalog/testimonials', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Rent', exact: true }).first()).toBeVisible();
  await expect(page.locator('#testimonials')).toHaveCount(0);
  await openMenu(page);
  await expect(page.getByRole('link', { name: 'Testimonials', exact: true })).toHaveCount(0);
});

test('a customer token receives 403 on testimonial writes', async ({ request }) => {
  const login = await request.post('/api/v1/auth/login', {
    headers: TENANT_HEADERS,
    data: {
      email: process.env.SEED_CUSTOMER_EMAIL ?? 'customer@admin.com',
      password: process.env.SEED_PASSWORD ?? 'admin',
    },
  });
  expect(login.ok()).toBe(true);
  const { accessToken } = await login.json();
  const headers = { ...TENANT_HEADERS, Authorization: `Bearer ${accessToken}` };
  const data = { headline: null, quote: 'QA fixture', authorName: 'QA', authorTitle: '' };
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const url =
      '/api/v1/tenants/me/testimonials' +
      (method === 'POST' ? '' : '/11111111-1111-4111-8111-111111111111');
    const response = await request.fetch(url, { method, headers, data });
    expect(response.status()).toBe(403);
  }
});
