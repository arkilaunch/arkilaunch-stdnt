import { describe, expect, it } from 'vitest';
import { cornersSteady, fullFrameDocument, snapPageSize, steadyHold, type ScanCorners } from './document-scanner.js';

function syntheticScan(width: number, height: number, margin = 0, white = false): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const border = x < width * margin || x > width * (1 - margin) || y < height * margin || y > height * (1 - margin);
    // Distributed thin glyph strokes on a bright paper/card surface.
    const stroke = y > height * 0.1 && y < height * 0.9 && y % 32 === 0 && x > width * 0.08 && x < width * 0.92 && x % 8 < 3;
    const light = border ? 120 : stroke ? 20 : white ? 255 : 245;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = light;
  }
  return { width, height, data } as ImageData;
}

describe('picked full-frame scans', () => {
  it.each([[640, 404, 0, false], [640, 404, 0.01, false], [640, 404, 0, true], [404, 640, 0, false], [454, 640, 0, true]] as const)('accepts a populated %sx%s scan with %s margin', (width, height, margin, white) => {
    expect(fullFrameDocument(syntheticScan(width, height, margin, white))).toMatchObject({ quality: 'ready', corners: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }] });
  });
  it('keeps blank, tiny-content and dense-noise images in manual review', () => {
    expect(fullFrameDocument({ width: 640, height: 404, data: new Uint8ClampedArray(640 * 404 * 4).fill(255) } as ImageData)).toBeNull();
    const image = syntheticScan(640, 404);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (x < 280 || x > 360 || y < 180 || y > 240) {
      const i = (y * image.width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 245;
    }
    expect(fullFrameDocument(image)).toBeNull();
    const noise = syntheticScan(640, 404);
    for (let y = 0; y < noise.height; y++) for (let x = 0; x < noise.width; x++) {
      const i = (y * noise.width + x) * 4;
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = x % 2 ? 255 : 0;
    }
    expect(fullFrameDocument(noise)).toBeNull();
  });
});

describe('document hold', () => {
  const corners: ScanCorners = [
    { x: 40, y: 40 }, { x: 500, y: 40 }, { x: 500, y: 400 }, { x: 40, y: 400 },
  ];

  it('keeps a small hand tremor inside the steady hold', () => {
    expect(cornersSteady(corners, corners.map(({ x, y }) => ({ x: x + 3, y: y - 2 })) as ScanCorners, 640, 480)).toBe(true);
  });

  it('resets the hold when a document corner moves', () => {
    const moved: ScanCorners = [...corners];
    moved[0] = { x: 70, y: 40 };
    expect(cornersSteady(corners, moved, 640, 480)).toBe(false);
  });

  it('captures after two steady seconds and restarts after movement', () => {
    const first = steadyHold(null, corners, null, 100, 640, 480);
    expect(first.ready).toBe(false);
    expect(steadyHold(corners, corners, first.startedAt, 2099, 640, 480).ready).toBe(false);
    expect(steadyHold(corners, corners, first.startedAt, 2100, 640, 480).ready).toBe(true);
    const moved = [...corners] as ScanCorners;
    moved[0] = { x: 70, y: 40 };
    const reset = steadyHold(corners, moved, first.startedAt, 2200, 640, 480);
    expect(reset).toMatchObject({ startedAt: 2200, progress: 0, ready: false });
  });
});

describe('snapPageSize', () => {
  const LETTER = 279.4 / 215.9;
  const LEGAL = 355.6 / 215.9;

  it('snaps a slightly skewed photo of a Legal sheet to the exact Legal ratio, either orientation', () => {
    expect(snapPageSize(2200, 1340, [LETTER, LEGAL])).toEqual({ width: 2200, height: Math.round(2200 / LEGAL) });
    expect(snapPageSize(1340, 2200, [LETTER, LEGAL])).toEqual({ width: Math.round(2200 / LEGAL), height: 2200 });
  });

  it('leaves a shape that is no known paper size alone', () => {
    expect(snapPageSize(1000, 1000, [LETTER, LEGAL])).toEqual({ width: 1000, height: 1000 });
  });
});
