import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./exec";

export function isHeic(mime: string): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

/**
 * Wandelt ein HEIC-Foto (iPhone-Standardformat) in JPEG um.
 * sharp kann HEIC (HEVC) aus Lizenzgründen nicht dekodieren – daher libheif (heif-convert).
 * Das Original bleibt unverändert gespeichert; die JPEG-Version dient nur der Auswertung und Vorschau.
 */
export async function heicToJpeg(heic: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "heic-"));
  try {
    const src = path.join(dir, "in.heic");
    await writeFile(src, heic);
    await run("heif-convert", ["-q", "92", src, path.join(dir, "out.jpg")]);
    // Bei mehreren Bildern in einer Datei (z. B. Serienaufnahme) schreibt heif-convert out-1.jpg, out-2.jpg …
    const files = (await readdir(dir)).filter((f) => f.startsWith("out") && f.endsWith(".jpg")).sort();
    if (!files.length) throw new Error("heif-convert hat kein Bild erzeugt");
    return readFile(path.join(dir, files[0]));
  } catch (e) {
    throw new Error(`HEIC-Foto konnte nicht umgewandelt werden: ${(e as Error).message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
