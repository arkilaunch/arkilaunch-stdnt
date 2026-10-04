import { test, expect } from '@playwright/test';
import { platformUrl } from './sign-in.js';

const almara = { slug: 'almara', name: 'Almara Construction', logoUrl: null, tagline: 'Construction equipment rentals', city: 'Quezon City', province: null, primaryColor: '#f2a100', categories: ['Excavator', 'Bulldozer'] };
const other = { ...almara, slug: 'sample-rental', name: 'Sample Rental Company' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/catalog/tenants')) return route.fulfill({ json: [] });
    const q = url.searchParams.get('q')?.toLowerCase() ?? '';
    const items = [almara, other].filter((t) => t.name.toLowerCase().includes(q));
    await route.fulfill({ json: { items, total: items.length, categories: ['Excavator', 'Bulldozer'], locations: ['Quezon City'] } });
  });
});

test('SaaS landing remains usable across responsive widths', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(platformUrl('/'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run your equipment rental business in one place.');
    await expect(page.getByText('Pilot partner', { exact: true })).toBeVisible();
    const image = page.getByRole('img', { name: /ArkiLaunch equipment inventory/ });
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page).toHaveTitle('ArkiLaunch | Equipment rental management software');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    if (width < 768) {
      const open = page.getByRole('button', { name: 'Open menu' });
      await open.click();
      await expect(page.getByRole('navigation', { name: 'Mobile primary' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(open).toBeFocused();
      await expect(open).toHaveAttribute('aria-expanded', 'false');
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`platform-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('directory filters do not remove the independent pilot feature and storefront actions work', async ({ page }) => {
  await page.goto(platformUrl('/'));
  await page.getByLabel('Company name', { exact: true }).fill('Sample');
  await expect(page).toHaveURL(/q=Sample/);
  await expect(page.getByText('1 company', { exact: true })).toBeVisible();
  await expect(page.getByText('Pilot partner', { exact: true })).toBeVisible();
  const storefront = page.getByRole('link', { name: /Visit Almara Construction/ });
  const expected = new URL(platformUrl('/'));
  expected.hostname = `almara.${expected.hostname}`;
  await expect(storefront).toHaveAttribute('href', expected.origin);
  await storefront.click();
  await expect(page).toHaveURL(expected.origin + '/');
});

test('registration and platform footer routes are reachable', async ({ page }) => {
  await page.goto(platformUrl('/'));
  await page.getByRole('link', { name: /Register your company/ }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('[data-platform-seo]')).toHaveCount(0);
  for (const [name, path] of [['Help', '/help'], ['Terms', '/terms'], ['Privacy', '/privacy']] as const) {
    await page.goto(platformUrl('/'));
    await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new URL(path, platformUrl('/')).href);
    await expect(page.getByRole('main')).toBeVisible();
  }
});

test('catalog failure preserves the product story and retry recovers', async ({ page }) => {
  await page.route('**/api/**/catalog/tenants?**', (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto(platformUrl('/'));
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Pilot partner', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/**/catalog/tenants?**');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('2 companies', { exact: true })).toBeVisible();
});
