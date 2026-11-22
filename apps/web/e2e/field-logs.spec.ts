import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

test('field logs are grouped by site, machine and week with rental hours and deposit', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/ocr');

  const group = page.getByTestId('site-group').first().getByTestId('machine-group').first();
  const summary = group.locator('summary');
  await summary.click();
  await expect(group.getByTestId('rental-hours')).toContainText('used');
  await expect(group.getByTestId('rental-deposit')).toContainText('Deposit left');

  const week = group.getByRole('region', { name: /^Week of / }).first();
  await expect(week).toBeVisible();
  await summary.click();
  await expect(week).toBeHidden();
  await summary.click();
  await expect(week).toBeVisible();
});
