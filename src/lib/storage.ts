import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

// Dateien liegen unter DATA_DIR/files/JJJJ/MM/<uuid>.<ext> – die Originale bleiben unverändert.

export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function sniffMime(buf: Buffer, declared?: string, filename?: string): string | null {
  if (buf.subarray(0, 4).toString() === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  const ftyp = buf.subarray(4, 12).toString();
  if (ftyp.startsWith("ftyp") && /heic|heix|mif1|msf1|heif/.test(ftyp)) return "image/heic";
  if (declared && ALLOWED_MIME[declared]) return declared;
  const ext = filename?.split(".").pop()?.toLowerCase();
  const found = Object.entries(ALLOWED_MIME).find(([, e]) => e === ext);
  return found ? found[0] : null;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function absolutePath(relative: string): string {
  const base = path.resolve(config.dataDir, "files");
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw new Error("Ungültiger Dateipfad");
  return full;
}

export async function saveFile(buf: Buffer, ext: string, date = new Date()): Promise<string> {
  const dir = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}`;
  const relative = `${dir}/${randomUUID()}.${ext}`;
  const full = absolutePath(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return relative;
}

export async function loadFile(relative: string): Promise<Buffer> {
  return readFile(absolutePath(relative));
}

export async function deleteFile(relative: string | null | undefined): Promise<void> {
  if (!relative) return;
  await rm(absolutePath(relative), { force: true });
}
