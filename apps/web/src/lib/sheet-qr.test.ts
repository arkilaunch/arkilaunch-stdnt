import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSheetQr } from './sheet-qr.js';

afterEach(() => vi.unstubAllGlobals());

describe('readSheetQr', () => {
  it("returns the sheet's own QR and ignores other codes", async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close })));
    vi.stubGlobal('BarcodeDetector', class {
      detect = () => Promise.resolve([{ rawValue: 'https://example.com' }, { rawValue: 'ARKI-EDTR3:a:b:2026-10-05' }]);
    });
    expect(await readSheetQr(new Blob())).toBe('ARKI-EDTR3:a:b:2026-10-05');
    expect(close).toHaveBeenCalled();
  });

  it('gives up quietly where the browser has no BarcodeDetector, or the image will not decode', async () => {
    expect(await readSheetQr(new Blob())).toBeNull();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('bad image'))));
    vi.stubGlobal('BarcodeDetector', class { detect = () => Promise.resolve([]); });
    expect(await readSheetQr(new Blob())).toBeNull();
  });
});
