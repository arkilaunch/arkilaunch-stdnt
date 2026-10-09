import { test, expect } from '@playwright/test';

test('picked full-frame and near-border files scan automatically while blank files need review', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  const results = await page.evaluate(async () => {
    const scanner = await import('/src/lib/document-scanner.ts');
    const cv = await scanner.loadDocumentScanner();
    const results = [];
    for (const [width, height, margin, populated] of [[640, 404, 0, true], [640, 404, 0.01, true], [404, 640, 0, true], [454, 640, 0, true], [640, 404, 0, false]] as const) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#888'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff'; ctx.fillRect(width * margin, height * margin, width * (1 - 2 * margin), height * (1 - 2 * margin));
      if (populated) {
        ctx.fillStyle = '#222'; ctx.font = `${Math.max(14, width / 32)}px sans-serif`;
        for (let line = 0; line < 9; line++) ctx.fillText('SPECIMEN DOCUMENT SAMPLE TEXT 12345', width * 0.08, height * (0.15 + line * 0.08));
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
      const bitmap = await createImageBitmap(new File([blob], 'picked-scan.png', { type: 'image/png' }), { imageOrientation: 'from-image' });
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const image = ctx.getImageData(0, 0, width, height);
      const found = scanner.analyzePickedDocument(cv, image);
      results.push({ width, height, populated, quality: found?.quality ?? null, corners: found?.corners ?? null });
    }
    return results;
  });
  for (const result of results) {
    if (result.populated) { expect(result.quality, `${result.width}x${result.height}`).toBe('ready'); expect(result.corners).toHaveLength(4); }
    else expect(result.quality).toBeNull();
  }
});

test('document scanner detects and straightens a clear page in the browser', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    const scanner = await import('/src/lib/document-scanner.ts');
    const cv = await scanner.loadDocumentScanner();
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#777';
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = '#f8f8f8';
    context.fillRect(90, 55, 460, 370);
    context.fillStyle = '#222';
    context.font = 'bold 25px sans-serif';
    for (let line = 0; line < 8; line++) context.fillText('COMPANY REGISTRATION 12345', 110, 110 + line * 34);
    const found = scanner.analyzeDocument(cv, context.getImageData(0, 0, 640, 480));
    if (!found) return null;
    const corrected = await scanner.straightenDocument(canvas, found.corners);
    return { quality: found.quality, corners: found.corners, size: corrected.size, type: corrected.type };
  });
  expect(result).not.toBeNull();
  expect(result?.quality).toBe('ready');
  expect(result?.corners).toHaveLength(4);
  expect(result?.size).toBeGreaterThan(1000);
  expect(result?.type).toBe('image/jpeg');
});
