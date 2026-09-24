import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sniffMime } from "../storage";
import { heicToJpeg } from "./heic";

const hasHeifConvert = (() => {
  try {
    execFileSync("heif-convert", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Echtes HEIC (HEVC), wie es ein iPhone liefert
const heic = readFileSync(new URL("../../../fixtures/bon.heic", import.meta.url));

describe("HEIC", () => {
  it("wird am Dateiinhalt erkannt", () => {
    expect(sniffMime(heic)).toBe("image/heic");
  });

  it.skipIf(!hasHeifConvert)("wird in ein JPEG umgewandelt, das sharp verarbeiten kann", async () => {
    const jpeg = await heicToJpeg(heic);
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(300);
  });

  it.skipIf(!hasHeifConvert)("liefert eine verständliche Fehlermeldung bei kaputten Dateien", async () => {
    await expect(heicToJpeg(Buffer.from("kein bild"))).rejects.toThrow(/HEIC-Foto konnte nicht umgewandelt werden/);
  });
});
