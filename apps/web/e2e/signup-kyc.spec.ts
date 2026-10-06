import { test, expect, type Page } from '@playwright/test';
import { parseIdText, type DocumentText } from '@arkilaunch/shared';
import { choose } from './select.js';

const rawLicence = 'Last Name, First Name, Middle Name\nSAN JUAN, ANA MARIA REYES\nAddress\n12 SAMPLE STREET\nBARANGAY UNO\nQUEZON CITY\nLicense No.\nN01-23-456789';
let offset = 0;
const lines = rawLicence.split('\n').map((value) => {
  const line = { offset, length: value.length, page: 1, polygon: [] };
  offset += value.length + 1;
  return line;
});
const text: DocumentText = { content: rawLicence, lines, words: lines.map((line) => ({ offset: line.offset, length: line.length, confidence: 0.96 })) };
const parsed = parseIdText('drivers_license', text);

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

for (const width of [360, 375, 390, 430, 1440]) {
  test(`signup and tightly cropped licence at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name === 'desktop' ? width !== 1440 : width === 1440);
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 851 });
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
    const form = page.locator('form');
    await expect(form.locator('input:not([type="checkbox"])')).toHaveCount(7);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Enter your first name', { exact: true })).toBeVisible();
    await expect(page.getByText('Enter your last name', { exact: true })).toBeVisible();
    await expect(page.getByText('Enter your job title or position', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /PH mobile number/ })).toBeVisible();
    // Required fields are validated before the confirm-password check.
    await page.getByLabel('First name', { exact: false }).fill(' Ana ');
    await page.getByLabel('Last name', { exact: false }).fill(' Peña ');
    await page.getByLabel('Mobile number', { exact: false }).fill('0917');
    await page.getByLabel('Email address', { exact: false }).fill(`pb-${Date.now()}-${width}-${info.project.name}@example.test`);
    await page.getByLabel('Job title/position', { exact: false }).fill(' Site Engineer ');
    await page.getByLabel(/^Password/).fill('a long test password');
    await page.getByLabel('Confirm password', { exact: false }).fill('a long test password');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /PH mobile number/ })).toBeVisible();
    await noOverflow(page);
    await page.getByLabel('Mobile number', { exact: false }).fill('+63 917 123 4567');
    await page.screenshot({ path: info.outputPath(`signup-${width}.png`), fullPage: true });
    const submit = page.getByRole('button', { name: 'Create account', exact: true });
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/auth/register-customer'));
    await submit.click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ firstName: 'Ana', lastName: 'Peña', mobileNumber: '+639171234567', jobTitle: 'Site Engineer' });
    await expect(page).toHaveURL(/\/account\/companies\/new/);
    await expect(page.getByRole('dialog', { name: 'Add a company' })).toBeVisible();
    const me = await page.evaluate(async () => {
      const { authorizedFetch } = await import('/src/lib/auth-client.ts');
      return (await authorizedFetch('/users/me')).json();
    });
    expect(me).toMatchObject({ contactFirstName: 'Ana', contactLastName: 'Peña', phone: '+639171234567', jobTitle: 'Site Engineer', firstName: null, middleName: null, lastName: null });

    // Mock the external OCR boundary using real parsed layout text. No live Azure calls.
    await page.route('**/api/v1/me/kyc/scan', async (route) => {
      expect(route.request().postData()).toContain('drivers_license');
      await route.fulfill({ json: { suggestions: { firstName: parsed.first_name!.value, middleName: parsed.middle_name!.value, lastName: parsed.last_name!.value, address: parsed.address!.value, idNumber: 'N01-23-456789', birthDate: '1990-01-02', sex: 'F', companyName: null, tin: null, secNumber: null, dtiNumber: null }, confidence: 0.96, extractionAvailable: true, layoutRecognized: null } });
    });
    await choose(page.getByLabel('ID type'), 'drivers_license');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 856; canvas.height = 540;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#222'; ctx.font = '24px sans-serif';
      ['SPECIMEN DRIVER LICENCE - NOT VALID', 'Last Name, First Name, Middle Name', 'SAN JUAN, ANA MARIA REYES', 'Address', '12 SAMPLE STREET, BARANGAY UNO', 'QUEZON CITY', 'License No. N01-23-456789'].forEach((value, index) => ctx.fillText(value, 40, 60 + index * 60));
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    await page.getByTestId('doc-government_id-file').setInputFiles({ name: 'specimen-licence.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    await expect(page.getByLabel('First name', { exact: false })).toHaveValue('ANA MARIA', { timeout: 60_000 });
    await expect(page.getByLabel('Middle name', { exact: false })).toHaveValue('REYES');
    await expect(page.getByLabel('Last name', { exact: false })).toHaveValue('SAN JUAN');
    await expect(page.getByLabel('Address on the ID')).toHaveValue('12 SAMPLE STREET, BARANGAY UNO, QUEZON CITY');
    await expect(page.getByRole('button', { name: 'Use original photo' })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`licence-${width}.png`), fullPage: true });
    await page.getByLabel('Address on the ID').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Address on the ID')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`licence-address-${width}.png`), fullPage: true });
    const next = page.getByRole('button', { name: 'Next: registration type' });
    await next.scrollIntoViewIfNeeded();
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await next.click();
    await expect(page.getByText('Step 4 of 7')).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('First name', { exact: false })).toHaveValue('ANA MARIA');
    await noOverflow(page);
  });
}
