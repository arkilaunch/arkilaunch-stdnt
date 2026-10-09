// The printed eDTR page, shared by the sheet printer (edtr-sheet.ts) and the scanner (document-scanner.ts).
// Kept apart from edtr-sheet.ts so the camera bundle does not pull in pdf-lib and qrcode.

export type PageSize = 'letter' | 'legal';

// Landscape, in mm. Changing one alone stretches the scan.
export const PAGE_MM: Record<PageSize, { w: number; h: number; label: string }> = {
  letter: { w: 279.4, h: 215.9, label: 'Letter 11 x 8.5 in' },
  legal: { w: 355.6, h: 215.9, label: 'Legal 14 x 8.5 in' },
};

// Four solid squares near the page corners: the scanner finds the page by these, not by its edge,
// so a hand on one edge or a busy background does not matter.
export const MARK_MM = 5;
export const MARK_INSET_MM = 4.5;

// Mark centres in mm, TL, TR, BR, BL.
export function markCentresMm(page: PageSize): [number, number][] {
  const { w, h } = PAGE_MM[page];
  const i = MARK_INSET_MM;
  return [
    [i, i],
    [w - i, i],
    [w - i, h - i],
    [i, h - i],
  ];
}

// Where the QR sits (mm), so a page found upside down can be turned upright.
export function qrBoxMm(page: PageSize): { x: number; y: number; size: number } {
  return { x: PAGE_MM[page].w - 8 - 24 - 3, y: 5, size: 24 };
}
