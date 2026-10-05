import { test } from '@playwright/test';
import { rentalJourney } from './rental-journey.js';

test('rental journey at the project device viewport', async ({ page }, info) => {
  test.setTimeout(120_000);
  await rentalJourney(page, info);
});

for (const viewport of [{ width: 360, height: 800 }, { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test.describe(`${viewport.width}x${viewport.height} rental journey`, () => {
    test.use({ viewport });
    test('reaches checkout through the existing phone confirmation gate', async ({ page }, info) => {
      test.setTimeout(120_000);
      await rentalJourney(page, info);
    });
  });
}
