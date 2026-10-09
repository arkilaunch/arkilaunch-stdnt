// Reads the eDTR sheet's QR from a photo with the browser's own BarcodeDetector (Chrome/Edge on Android, no library).
// Where it is missing (iOS Safari, Firefox) this returns null and the user picks the site and machine by hand; the
// OCR worker reads the QR again server-side either way.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export async function readSheetQr(file: Blob): Promise<string | null> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Detector || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const codes = await new Detector({ formats: ['qr_code'] }).detect(bitmap);
      return codes.find((c) => c.rawValue.startsWith('ARKI-EDTR'))?.rawValue ?? null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
