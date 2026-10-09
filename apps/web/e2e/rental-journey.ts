import { expect, type Page, type TestInfo } from '@playwright/test';
import type { AvailabilityResponse } from '@arkilaunch/shared';
import { signInAsCustomer, TENANT_HEADERS } from './sign-in.js';
import { openSidebar, sidebarLink } from './sidebar.js';

export async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

async function touchTarget(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

export async function rentalJourney(page: Page, info: TestInfo, checkDetail = false) {
  const login = page.waitForResponse(r => r.url().includes('/auth/login') && r.request().method() === 'POST');
  await signInAsCustomer(page);
  const { accessToken } = await (await login).json();
  let bookingId: string | undefined;
  try {
    await page.goto('/equipment');
    // Migration 0079's inherited costs exceed the seed backhoe's card; the excavator remains quotable.
    const model = page.getByRole('button', { name: 'Komatsu PC200', exact: true });
    await expect(model).toBeVisible();
    await noOverflow(page);
    if (checkDetail) {
      await model.click();
      await expect(page).toHaveURL(/\/equipment\/[\w-]+$/);
      await noOverflow(page);
      await page.goBack();
    }
    const availability = page.waitForResponse(r => r.url().includes('/availability') && r.ok());
    await model.locator('..').locator('..').locator('..').getByRole('button', { name: 'Rent', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Configure rental' });
    await expect(dialog).toBeFocused();
    await expect(dialog.locator('input[type="datetime-local"]:focus')).toHaveCount(0);
    await noOverflow(page);
    const data: AvailabilityResponse = await (await availability).json();
    const count = Math.max(2, Math.ceil(data.minHours / data.dailyHours) + 1);
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
    const startIndex = data.days.findIndex((day, index) => {
      const range = data.days.slice(index, index + count);
      return day.date >= tomorrow && range.length === count && day.available && range.at(-1)!.available &&
        range.every(d => d.available || d.reason === 'closed' || d.reason === 'holiday');
    });
    expect(startIndex, 'Seed equipment has no free rental window meeting the tenant minimum').toBeGreaterThanOrEqual(0);
    const start = data.days[startIndex]!.date;
    const end = data.days[startIndex + count - 1]!.date;
    for (const day of [start, end]) {
      const date = dialog.locator(`[data-date="${day}"]`);
      for (let month = 0; month < 3 && !(await date.isVisible()); month++) {
        await dialog.getByRole('button', { name: 'Next month', exact: true }).click();
      }
      await date.click();
    }
    const add = dialog.getByRole('button', { name: 'Add to cart', exact: true });
    await expect(add).toBeEnabled();
    await touchTarget(add);
    await page.screenshot({ path: info.outputPath('configure-rental.png') });
    await add.click();
    await openSidebar(page);
    const cartLink = sidebarLink(page, 'Cart');
    await expect(cartLink).toBeVisible();
    await touchTarget(cartLink);
    await cartLink.click();
    await expect(page.getByRole('heading', { name: 'Shopping cart' })).toBeVisible();
    await noOverflow(page);
    const phone = page.viewportSize()!.width < 768;
    const actions = page.getByTestId('cart-mobile-actions');
    await expect(actions)[phone ? 'toBeVisible' : 'toBeHidden']();
    if (phone) {
      await expect(actions).toContainText('₱');
      const edit = page.getByRole('button', { name: 'Edit dates', exact: true }).first();
      await touchTarget(edit);
      await edit.click();
      await expect(page.getByLabel('Rental start')).toBeVisible();
      await noOverflow(page);
      await page.getByRole('button', { name: 'Done editing dates' }).click();
      await expect(page.getByLabel('Rental start')).toBeHidden();
      await expect(actions).toBeInViewport();
    } else {
      await expect(page.getByLabel('Rental start')).toBeVisible();
    }
    await page.getByRole('combobox', { name: 'Project site', exact: true }).click();
    await page.getByRole('option').filter({ hasNotText: /Select|No sites|proof needed/ }).first().click();
    await page.getByLabel('Site access notes').evaluate(el => el.scrollIntoView({ block: 'end' }));
    await noOverflow(page);
    if (phone) {
      const notes = await page.getByLabel('Site access notes').boundingBox();
      const bar = await actions.boundingBox();
      expect(notes!.y + notes!.height).toBeLessThanOrEqual(bar!.y);
    }
    const request = page.getByRole('button', { name: 'Request a quote', exact: true }).filter({ visible: true });
    await touchTarget(request);
    await request.scrollIntoViewIfNeeded();
    await expect(request).toBeInViewport();
    await page.screenshot({ path: info.outputPath('cart-actions.png'), fullPage: true });
    const response = page.waitForResponse(r => /\/bookings$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await request.click();
    const created = await response;
    expect(created.ok(), 'Seed customer booking submission failed').toBeTruthy();
    bookingId = (await created.json()).id;
    await expect(page.getByText('Request sent', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Negotiate via messenger' }).click();
    const inApp = page.getByRole('button', { name: /In-app chat/ });
    if (await inApp.isVisible()) await inApp.click();
    await expect(page).toHaveURL(/\/account\/negotiation\/[\w-]+(?:\/chat)?$/);
    await noOverflow(page);
    const accept = page.getByRole('button', { name: 'Accept quote', exact: true });
    await expect(accept, 'The seeded equipment must have a rate card to auto-approve a quote').toBeVisible();
    const quote = await accept.boundingBox();
    const thread = await page.getByRole('heading', { name: 'Conversation' }).boundingBox();
    if (page.viewportSize()!.width < 1024) expect(quote!.y).toBeLessThan(thread!.y);
    else expect(quote!.x).toBeGreaterThan(thread!.x);
    await page.getByRole('button', { name: 'Negotiate', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('negotiation.png'), fullPage: true });
    await page.goBack();
    await expect(page).toHaveURL(/\/account\/cart/);
    await page.goForward();
    await touchTarget(accept);
    await accept.click();
    await expect(page).toHaveURL(/\/final$/);
    await page.getByRole('link', { name: 'Proceed to payment' }).click();
    await expect(page).toHaveURL(/\/account\/checkout\/[\w-]+$/);
    await expect(page.getByText('Confirm by phone first', { exact: true })).toBeVisible();
    await noOverflow(page);
    await info.attach('rental-journey-evidence', { body: JSON.stringify({ viewport: page.viewportSize(), project: info.project.name, flow: 'configure > drawer cart > quote > negotiation > accept > checkout call gate', overflow: 'PASS', focus: 'PASS', order: 'PASS', touchTargets: 'PASS', contentClearance: 'PASS', backNavigation: 'PASS' }), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('checkout-gate.png'), fullPage: true });
  } finally {
    if (bookingId) {
      const cleanup = await page.request.patch(`/api/v1/bookings/${bookingId}/cancel`, { headers: { ...TENANT_HEADERS, Authorization: `Bearer ${accessToken}` }, data: {} });
      expect(cleanup.ok(), 'Test booking cleanup failed').toBeTruthy();
    }
  }
}
