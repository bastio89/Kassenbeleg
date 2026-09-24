// Selbsttest ohne KI: prüft, ob alle lokalen Werkzeuge im Container funktionieren.
// Aufruf auf dem Server:  docker compose exec worker npm run selftest
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, effectiveMode } from "../lib/config";
import { hasModel, ollamaStatus } from "../lib/ai/ollama";
import { heicToJpeg } from "../lib/ocr/heic";
import { makePreview } from "../lib/ocr/image";
import { pdfText, pdfToImages } from "../lib/ocr/pdf";
import { ocrImage } from "../lib/ocr/tesseract";
import { findDateInText, findTotalInText, parseItemsFromText } from "../lib/parse";

const dir = path.resolve("fixtures");
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const info = await fn();
    console.log(`✅ ${name} (${Date.now() - t0} ms)${info ? ` – ${info}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`❌ ${name}: ${(e as Error).message}`);
  }
}

function expect(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

await check("Texterkennung (Tesseract) auf Kassenbon-Foto", async () => {
  const text = await ocrImage(await readFile(path.join(dir, "bon.jpg")));
  const items = parseItemsFromText(text);
  const total = findTotalInText(text);
  expect(findDateInText(text) === "2025-08-14", `Datum nicht erkannt:\n${text}`);
  expect(total === 21.18, `Summe nicht erkannt (${total})`);
  expect(items.length >= 8, `nur ${items.length} Positionen erkannt`);
  return `${items.length} Positionen, Summe ${total}`;
});

await check("iPhone-Foto (HEIC) umwandeln", async () => {
  const jpeg = await heicToJpeg(await readFile(path.join(dir, "bon.heic")));
  await makePreview(jpeg);
  return `${Math.round(jpeg.length / 1024)} KB JPEG`;
});

await check("PDF-Rechnung: eingebetteter Text", async () => {
  const text = await pdfText(await readFile(path.join(dir, "rechnung.pdf")));
  expect(/Waschmaschine/.test(text), "Text nicht gefunden");
  return `${text.length} Zeichen`;
});

await check("PDF-Rechnung: Seite als Bild", async () => {
  const pages = await pdfToImages(await readFile(path.join(dir, "rechnung.pdf")), 1);
  expect(pages.length === 1, "keine Seite gerendert");
  return "";
});

if (process.argv.includes("--ki")) {
  await check(`KI (${config.ai.provider})`, async () => {
    if (config.ai.provider === "openrouter") {
      expect(Boolean(config.ai.openrouter.apiKey), "OPENROUTER_API_KEY fehlt");
      return config.ai.openrouter.model;
    }
    const status = await ollamaStatus();
    expect(status.reachable, `Ollama nicht erreichbar (${status.error})`);
    const model = effectiveMode("ollama") === "vision" ? config.ai.ollama.visionModel : config.ai.ollama.model;
    expect(hasModel(status.models, model), `Modell ${model} noch nicht geladen`);
    return model;
  });
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
