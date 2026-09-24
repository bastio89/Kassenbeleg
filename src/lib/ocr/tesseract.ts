import { config } from "../config";
import { run } from "./exec";
import { prepareForOcr } from "./image";

/** Texterkennung mit Tesseract (lokal, kein Netzwerk). */
export async function ocrImage(image: Buffer): Promise<string> {
  const prepared = await prepareForOcr(image);
  // PSM 6 = ein einheitlicher Textblock – hält Artikelname und Preis zuverlässig in einer Zeile
  const out = await run("tesseract", ["stdin", "stdout", "-l", config.ocr.languages, "--psm", "6"], prepared);
  return cleanOcrText(out.toString("utf8"));
}

export function cleanOcrText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l, i, arr) => l.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""))
    .join("\n")
    .trim();
}
