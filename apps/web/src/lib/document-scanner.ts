import { PAGE_MM, markCentresMm, qrBoxMm, type PageSize } from './sheet-marks.js';
export interface ScanPoint { x: number; y: number }
export type ScanCorners = [ScanPoint, ScanPoint, ScanPoint, ScanPoint];
export interface ScanResult {
  corners: ScanCorners;
  width: number;
  height: number;
  quality: 'ready' | 'dark' | 'glare' | 'blurry';
}

type Cv = typeof import('@techstark/opencv-js');
let cvPromise: Promise<Cv> | null = null;

// The pinned browser build is requested only when a KYC scanner opens.
export function loadDocumentScanner(): Promise<Cv> {
  cvPromise ??= new Promise<Cv>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/opencv-4.13.0.js';
    script.async = true;
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Document scanner timed out')); }, 30_000);
    script.onload = () => {
      const runtime = (window as Window & { cv?: Cv }).cv;
      if (!runtime) { clearTimeout(timeout); reject(new Error('Document scanner did not initialize')); return; }
      const started = performance.now();
      const ready = () => {
        if (typeof runtime.Mat === 'function') {
          // This Emscripten build leaves a then method on the ready object.
          // Promise resolution would treat it as an unresolved thenable.
          Object.defineProperty(runtime, 'then', { value: undefined, configurable: true });
          clearTimeout(timeout);
          resolve(runtime);
        } else if (performance.now() - started < 20_000) {
          setTimeout(ready, 100);
        } else { clearTimeout(timeout); reject(new Error('Document scanner timed out')); }
      };
      ready();
    };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Document scanner could not load')); };
    document.head.append(script);
  }).catch((error: unknown) => {
    cvPromise = null;
    throw error;
  });
  return cvPromise;
}

function orderCorners(points: ScanPoint[]): ScanCorners {
  const sums = points.map((point) => point.x + point.y);
  const differences = points.map((point) => point.x - point.y);
  return [
    points[sums.indexOf(Math.min(...sums))]!,
    points[differences.indexOf(Math.max(...differences))]!,
    points[sums.indexOf(Math.max(...sums))]!,
    points[differences.indexOf(Math.min(...differences))]!,
  ];
}

function qualityOf(image: ImageData, pickedFile = false): ScanResult['quality'] {
  const { width, height, data } = image;
  let brightness = 0;
  let strongEdges = 0;
  let count = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = (y * width + x) * 4;
      const light = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      brightness += light;
      if (Math.abs(light - (data[i + 4]! + data[i + 5]! + data[i + 6]!) / 3) > 12) strongEdges++;
      count++;
    }
  }
  if (!count || brightness / count < 40) return 'dark';
  if (!pickedFile && brightness / count > 248) return 'glare';
  return strongEdges / count < 0.002 ? 'blurry' : 'ready';
}

export function analyzePickedDocument(cv: Cv, image: ImageData): ScanResult | null {
  const found = analyzeDocument(cv, image);
  if (found) return { ...found, quality: qualityOf(image, true) };
  return fullFrameDocument(image);
}

export function fullFrameDocument(image: ImageData): ScanResult | null {
  const { width, height, data } = image;
  const ratio = Math.max(width, height) / Math.min(width, height);
  // Picked scans only: ID-1 and A4/Letter (either orientation), with a small
  // aspect tolerance. Require distributed readable contrast, not a blank scan,
  // a tiny card in a large scene or dense random noise. Camera rules stay stricter.
  if (Math.min(width, height) < 100 || ratio < 1.24 || ratio > 1.70 || qualityOf(image, true) !== 'ready') return null;
  let minX = width, maxX = 0, minY = height, maxY = 0, edges = 0, samples = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const i = (y * width + x) * 4;
      const light = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      samples++;
      if (Math.abs(light - (data[i + 4]! + data[i + 5]! + data[i + 6]!) / 3) > 12) {
        edges++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (edges / samples > 0.18 || maxX - minX < width * 0.55 || maxY - minY < height * 0.35) return null;
  return { corners: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], width, height, quality: 'ready' };
}

export function analyzeDocument(cv: Cv, image: ImageData): ScanResult | null {
  const source = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best: { corners: ScanCorners; area: number } | null = null;
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 65, 160);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      const approx = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, perimeter * 0.025, true);
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        const area = cv.contourArea(approx);
        const portion = area / (image.width * image.height);
        if (portion < 0.18 || portion > 0.9 || area <= (best?.area ?? 0)) continue;
        const corners = orderCorners(Array.from({ length: 4 }, (_, point) => ({
          x: approx.data32S[point * 2]!, y: approx.data32S[point * 2 + 1]!,
        })));
        if (corners.some(({ x, y }) => x < image.width * 0.02 || y < image.height * 0.02 || x > image.width * 0.98 || y > image.height * 0.98)) continue;
        best = { corners, area };
      } finally {
        approx.delete();
        contour.delete();
      }
    }
    return best && { ...best, width: image.width, height: image.height, quality: qualityOf(image) };
  } finally {
    source.delete(); gray.delete(); blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
}

export function cornersSteady(previous: ScanCorners, next: ScanCorners, width: number, height: number): boolean {
  const limit = Math.hypot(width, height) * 0.015;
  return previous.every((point, index) => Math.hypot(point.x - next[index]!.x, point.y - next[index]!.y) <= limit);
}

export function steadyHold(previous: ScanCorners | null, next: ScanCorners, since: number | null, now: number, width: number, height: number) {
  const startedAt = previous && cornersSteady(previous, next, width, height) ? (since ?? now) : now;
  const elapsed = now - startedAt;
  return { startedAt, progress: Math.min(1, elapsed / 2000), ready: elapsed >= 2000 };
}

// Snaps a near-match to the exact paper ratio (long side / short side), keeping orientation and the long side.
export function snapPageSize(width: number, height: number, ratios: readonly number[], slack = 0.08): { width: number; height: number } {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const ratio = long / short;
  const target = ratios.find((r) => Math.abs(ratio - r) / r <= slack);
  if (!target) return { width, height };
  const snappedShort = Math.round(long / target);
  return width >= height ? { width: long, height: snappedShort } : { width: snappedShort, height: long };
}

export async function straightenDocument(
  source: HTMLCanvasElement,
  corners: ScanCorners,
  options: { snapAspect?: readonly number[] | undefined } = {},
): Promise<File> {
  const cv = await loadDocumentScanner();
  const distance = (a: ScanPoint, b: ScanPoint) => Math.hypot(a.x - b.x, a.y - b.y);
  const rawWidth = Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2]));
  const rawHeight = Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]));
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % 4];
    return sum + point.x * next!.y - next!.x * point.y;
  }, 0)) / 2;
  if (rawWidth < 100 || rawHeight < 100 || area < source.width * source.height * 0.05) {
    throw new Error('Document corners need more space');
  }
  const scale = Math.min(1, 2200 / Math.max(rawWidth, rawHeight));
  const scaled = { width: Math.max(1, Math.round(rawWidth * scale)), height: Math.max(1, Math.round(rawHeight * scale)) };
  const { width, height } = options.snapAspect ? snapPageSize(scaled.width, scaled.height, options.snapAspect) : scaled;
  const input = cv.imread(source);
  const output = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(({ x, y }) => [x, y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  const transform = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(input, output, transform, new cv.Size(width, height));
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, output);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) throw new Error('Could not save the straightened photo');
    return new File([blob], `document-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } finally {
    input.delete(); output.delete(); from.delete(); to.delete(); transform.delete();
  }
}

// Calibration knobs for the reviewer's B/W view: a larger C keeps more paper white; too large drops faint pencil.
const SCAN_BLOCK_SIZE = 31;
const SCAN_C = 12;

// The photocopy look for a human reviewer only: the model always reads the colour original.
export async function toScannedPage(url: string): Promise<string> {
  const cv = await loadDocumentScanner();
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    // Without CORS the canvas is tainted and toDataURL throws; the caller falls back to the original.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The scan did not load'));
    img.src = url;
  });
  const source = cv.imread(image);
  const gray = new cv.Mat();
  const output = new cv.Mat();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(gray, output, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, SCAN_BLOCK_SIZE, SCAN_C);
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, output);
    return canvas.toDataURL('image/png');
  } finally {
    source.delete(); gray.delete(); output.delete();
  }
}

// ---------------------------------------------------------------- eDTR registration marks

export interface MarkCandidate { x: number; y: number; size: number }
export interface SheetMarks { marks: ScanCorners; page: PageSize }

// Solid dark squares about the size of a printed mark; the QR's finder patterns are hollow, so they fall out on fill.
export function findMarkCandidates(cv: Cv, image: ImageData): MarkCandidate[] {
  const long = Math.max(image.width, image.height);
  const source = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    const block = Math.max(31, Math.round(long / 25) | 1);
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, block, 15);
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const found: MarkCandidate[] = [];
    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      try {
        const rect = cv.boundingRect(contour);
        const side = (rect.width + rect.height) / 2;
        if (side < long * 0.004 || side > long * 0.035) continue;
        if (rect.width / rect.height < 0.7 || rect.width / rect.height > 1.4) continue;
        let ink = 0;
        for (let y = rect.y; y < rect.y + rect.height; y++) {
          for (let x = rect.x; x < rect.x + rect.width; x++) if (binary.data[y * binary.cols + x]) ink++;
        }
        if (ink / (rect.width * rect.height) < 0.85) continue;
        found.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, size: side });
      } finally {
        contour.delete();
      }
    }
    return found;
  } finally {
    source.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
  }
}

const dist = (a: ScanPoint, b: ScanPoint) => Math.hypot(a.x - b.x, a.y - b.y);

// Clockwise on screen (y down), first edge a long one (the sheet is landscape), top edge first.
// Upside down is settled afterwards by where the QR is.
function orderLandscape(points: ScanPoint[]): ScanCorners {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const ring = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const across = dist(ring[0]!, ring[1]!) + dist(ring[2]!, ring[3]!);
  const down = dist(ring[1]!, ring[2]!) + dist(ring[3]!, ring[0]!);
  const start = across >= down ? 0 : 1;
  const ordered = [0, 1, 2, 3].map((i) => ring[(i + start) % 4]!);
  const topFirst = ordered[0]!.y + ordered[1]!.y <= ordered[2]!.y + ordered[3]!.y;
  return (topFirst ? ordered : [ordered[2]!, ordered[3]!, ordered[0]!, ordered[1]!]) as ScanCorners;
}

function markRatio(page: PageSize): number {
  const [tl, tr, , bl] = markCentresMm(page);
  return (tr![0] - tl![0]) / (bl![1] - tl![1]);
}

function fitPage(corners: ScanCorners): PageSize | null {
  const top = dist(corners[0], corners[1]);
  const bottom = dist(corners[3], corners[2]);
  const right = dist(corners[1], corners[2]);
  const left = dist(corners[0], corners[3]);
  if (!left || !right) return null;
  const ratio = (top + bottom) / (left + right);
  const close = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) < 0.3;
  if (!close(top, bottom) || !close(left, right)) return null;
  // Generous: a phone held at an angle foreshortens one side.
  return (['legal', 'letter'] as const).find((p) => Math.abs(ratio - markRatio(p)) / markRatio(p) < 0.14) ?? null;
}

const quadArea = (c: ScanCorners) =>
  Math.abs(c.reduce((sum, p, i) => sum + p.x * c[(i + 1) % 4]!.y - c[(i + 1) % 4]!.x * p.y, 0)) / 2;

// The four marks, or three when a finger covers one (the fourth completes the parallelogram).
export function pickSheetMarks(candidates: MarkCandidate[], imageArea: number): SheetMarks | null {
  // ponytail: brute force over at most 16 candidates (1820 quads); a printed page has few solid squares.
  const pool = [...candidates].sort((a, b) => b.size - a.size).slice(0, 16);
  const sameSize = (set: MarkCandidate[]) => Math.max(...set.map((c) => c.size)) / Math.min(...set.map((c) => c.size)) < 1.8;
  let best: { marks: ScanCorners; page: PageSize; area: number } | null = null;
  const consider = (points: ScanPoint[]) => {
    const marks = orderLandscape(points);
    const page = fitPage(marks);
    const area = quadArea(marks);
    if (page && area > imageArea * 0.12 && area > (best?.area ?? 0)) best = { marks, page, area };
  };
  for (let a = 0; a < pool.length; a++)
    for (let b = a + 1; b < pool.length; b++)
      for (let c = b + 1; c < pool.length; c++)
        for (let d = c + 1; d < pool.length; d++) {
          const set = [pool[a]!, pool[b]!, pool[c]!, pool[d]!];
          if (sameSize(set)) consider(set);
        }
  if (!best) {
    for (let a = 0; a < pool.length; a++)
      for (let b = a + 1; b < pool.length; b++)
        for (let c = b + 1; c < pool.length; c++) {
          const set = [pool[a]!, pool[b]!, pool[c]!];
          if (!sameSize(set)) continue;
          // The corner between the other two is the one with the right angle.
          for (const [p, q, r] of [[set[0]!, set[1]!, set[2]!], [set[1]!, set[0]!, set[2]!], [set[2]!, set[0]!, set[1]!]] as const) {
            const u = { x: q.x - p.x, y: q.y - p.y };
            const v = { x: r.x - p.x, y: r.y - p.y };
            const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
            if (Math.abs(cos) < 0.2) consider([p, q, r, { x: q.x + r.x - p.x, y: q.y + r.y - p.y }]);
          }
        }
  }
  const chosen = best as { marks: ScanCorners; page: PageSize } | null;
  return chosen && { marks: chosen.marks, page: chosen.page };
}

// Shadows and uneven light out, ink kept: gray / local paper brightness, then stretch so ink is dark.
// No thresholding, so faint ballpoint and decimal points survive for the reader.
const LIGHT_BLOCK = 16;
export function normalizeLighting(image: ImageData): ImageData {
  const { width, height, data } = image;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114;
  // Paper brightness per block is its brightest pixel: ink only ever darkens.
  const bw = Math.ceil(width / LIGHT_BLOCK);
  const bh = Math.ceil(height / LIGHT_BLOCK);
  const blocks = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let max = 0;
      for (let y = by * LIGHT_BLOCK; y < Math.min(height, (by + 1) * LIGHT_BLOCK); y++)
        for (let x = bx * LIGHT_BLOCK; x < Math.min(width, (bx + 1) * LIGHT_BLOCK); x++) max = Math.max(max, gray[y * width + x]!);
      blocks[by * bw + bx] = max;
    }
  // Averaged with neighbours, so a block that is all ink borrows its neighbours' paper.
  const paper = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x >= 0 && y >= 0 && x < bw && y < bh) { sum += blocks[y * bw + x]!; n++; }
        }
      paper[by * bw + bx] = sum / n;
    }
  const flat = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const light = Math.max(1, paper[Math.floor(y / LIGHT_BLOCK) * bw + Math.floor(x / LIGHT_BLOCK)]!);
      flat[y * width + x] = (gray[y * width + x]! * 255) / light;
    }
  // The darkest 1% becomes black: ink at full contrast whatever the light was.
  const histogram = new Array<number>(256).fill(0);
  for (const v of flat) histogram[v]!++;
  let low = 0;
  for (let seen = 0; low < 255 && seen + histogram[low]! < flat.length * 0.01; low++) seen += histogram[low]!;
  // Capped: a page with little ink would otherwise stretch paper grain into fake strokes.
  const span = 255 - Math.min(low, 100);
  const out = new ImageData(width, height);
  for (let i = 0; i < flat.length; i++) {
    const v = ((flat[i]! - Math.min(low, 100)) * 255) / span;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

function darkShare(image: ImageData, box: { x: number; y: number; w: number; h: number }): number {
  let dark = 0;
  let n = 0;
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(image.height, box.y + box.h); y += 2)
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(image.width, box.x + box.w); x += 2) {
      const i = (y * image.width + x) * 4;
      if ((image.data[i]! + image.data[i + 1]! + image.data[i + 2]!) / 3 < 110) dark++;
      n++;
    }
  return n ? dark / n : 0;
}

// The QR is top-right on every printed sheet: when its spot is paler than the opposite corner, the page is upside down.
export function isUpsideDown(image: ImageData, page: PageSize, pxPerMm: number): boolean {
  const qr = qrBoxMm(page);
  const { w, h } = PAGE_MM[page];
  const here = darkShare(image, { x: qr.x * pxPerMm, y: qr.y * pxPerMm, w: qr.size * pxPerMm, h: qr.size * pxPerMm });
  const there = darkShare(image, {
    x: (w - qr.x - qr.size) * pxPerMm,
    y: (h - qr.y - qr.size) * pxPerMm,
    w: qr.size * pxPerMm,
    h: qr.size * pxPerMm,
  });
  return there > 0.2 && there > here * 1.5;
}

export function rotate180(image: ImageData): ImageData {
  const { width, height } = image;
  const turned = new ImageData(width, height);
  const pixels = width * height;
  for (let i = 0; i < pixels; i++) turned.data.set(image.data.subarray(i * 4, i * 4 + 4), (pixels - 1 - i) * 4);
  return turned;
}

// Marks to a flat, upright, evenly lit page at its true printed size.
export async function straightenBySheetMarks(source: HTMLCanvasElement, found: SheetMarks): Promise<File> {
  const cv = await loadDocumentScanner();
  const { w, h } = PAGE_MM[found.page];
  const pxPerMm = 2200 / w;
  const width = Math.round(w * pxPerMm);
  const height = Math.round(h * pxPerMm);
  const input = cv.imread(source);
  const output = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, found.marks.flatMap(({ x, y }) => [x, y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, markCentresMm(found.page).flatMap(([x, y]) => [x * pxPerMm, y * pxPerMm]));
  const transform = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(input, output, transform, new cv.Size(width, height));
    const flat = document.createElement('canvas');
    cv.imshow(flat, output);
    const context = flat.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    let page = normalizeLighting(context.getImageData(0, 0, width, height));
    if (isUpsideDown(page, found.page, pxPerMm)) page = rotate180(page);
    context.putImageData(page, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => flat.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Could not save the straightened photo');
    return new File([blob], `edtr-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } finally {
    input.delete(); output.delete(); from.delete(); to.delete(); transform.delete();
  }
}

// Marks on a canvas up to 2200 px; null when the sheet has none (older prints) or too few are visible.
export async function detectSheetMarks(source: HTMLCanvasElement): Promise<SheetMarks | null> {
  const cv = await loadDocumentScanner();
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const image = context.getImageData(0, 0, source.width, source.height);
  return pickSheetMarks(findMarkCandidates(cv, image), source.width * source.height);
}
