import sharp from "sharp";

/** Dreht nach EXIF, konvertiert in Graustufen und schärft – optimiert für Tesseract. */
export async function prepareForOcr(input: Buffer): Promise<Buffer> {
  const img = sharp(input, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  // Kassenbons sind schmal: ~1600–2000 px Breite liefern die beste Erkennung
  const target = width > 2400 ? 2000 : width < 1000 ? 1600 : undefined;
  return img
    .resize(target ? { width: target } : undefined)
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

/** Verkleinertes JPEG für Vision-Modelle (spart Rechenzeit und Tokens). */
export async function prepareForVision(input: Buffer, maxSide = 1600): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Vorschaubild für die Weboberfläche. */
export async function makePreview(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
