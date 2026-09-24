import sharp from "sharp";
import { categorizeItems, extractReceipt, type AiContext } from "./ai";
import type { Extraction } from "./ai/types";
import { buildLookup, getCategories, resolveCategoryPath } from "./categories";
import { effectiveMode, config } from "./config";
import { checkDuplicate } from "./duplicates";
import { sql } from "./db";
import { makePreview, prepareForVision } from "./ocr/image";
import { pdfText, pdfToImages } from "./ocr/pdf";
import { ocrImage } from "./ocr/tesseract";
import {
  findDateInText,
  findTimeInText,
  findTotalInText,
  normalizeItemName,
  parseItemsFromText,
  round2,
} from "./parse";
import type { ReceiptRow } from "./receipts";
import { deleteFile, loadFile, saveFile } from "./storage";

export interface ProcessedItem {
  position: number;
  name: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
  categoryId: number | null;
  categorySource: "ai" | "rule" | "keyword" | "fallback";
  warrantyMonths: number | null;
}

interface Prepared {
  text: string;
  visionImages: Buffer[];
  preview: Buffer | null;
}

/** Texterkennung bzw. Textextraktion für Foto oder PDF. */
async function prepare(receipt: ReceiptRow, file: Buffer): Promise<Prepared> {
  if (receipt.mime_type === "image/heic" || receipt.mime_type === "image/heif") {
    const readable = await sharp(file).metadata().then(() => true, () => false);
    if (!readable) {
      throw new Error(
        "HEIC-Fotos können nicht gelesen werden. Bitte als JPG senden (iPhone: Einstellungen → Kamera → Formate → „Maximale Kompatibilität“).",
      );
    }
  }
  const wantVision = effectiveMode(config.ai.provider) === "vision" || config.ai.fallback === "openrouter";
  if (receipt.mime_type === "application/pdf") {
    const embedded = await pdfText(file).catch(() => "");
    const pages = await pdfToImages(file, embedded.length > 80 ? 1 : 3).catch(() => [] as Buffer[]);
    const preview = pages[0] ? await makePreview(pages[0]) : null;
    if (embedded.length > 80) {
      // Digitale Rechnung: der eingebettete Text ist exakt – kein OCR/Bild nötig
      return { text: embedded, visionImages: [], preview };
    }
    const texts: string[] = [];
    for (const page of pages) texts.push(await ocrImage(page));
    const visionImages = wantVision ? await Promise.all(pages.map((p) => prepareForVision(p))) : [];
    return { text: texts.join("\n\n--- Seite ---\n\n"), visionImages, preview };
  }
  const [text, preview, vision] = await Promise.all([
    ocrImage(file),
    makePreview(file),
    wantVision ? prepareForVision(file) : Promise.resolve(null),
  ]);
  return { text, visionImages: vision ? [vision] : [], preview };
}

/** Plausibilisiert die KI-Ausgabe mit dem OCR-Text. */
export function reconcile(ex: Extraction, text: string): { extraction: Extraction; review: string[] } {
  const review: string[] = [];
  const e = { ...ex, items: [...ex.items] };
  if (!e.date) e.date = findDateInText(text);
  if (!e.time) e.time = findTimeInText(text);
  const textTotal = findTotalInText(text);
  const itemSum = round2(e.items.reduce((s, i) => s + i.totalPrice, 0));
  const lineItems = parseItemsFromText(text);
  const lineSum = round2(lineItems.reduce((s, i) => s + i.totalPrice, 0));

  if (e.total === null) e.total = textTotal ?? (e.items.length ? itemSum : null);
  else if (
    textTotal !== null &&
    Math.abs(textTotal - e.total) > 0.01 &&
    (Math.abs(textTotal - itemSum) < 0.02 || (lineItems.length > 0 && Math.abs(textTotal - lineSum) < 0.02))
  ) {
    // OCR-Summe passt exakt zu den Positionen, KI-Summe nicht → OCR vertrauen
    e.total = textTotal;
  }

  // Gegenprobe mit regelbasiert gelesenen Zeilen: Gewinner ist die Variante, deren Summe zum Gesamtbetrag passt
  if (lineItems.length && e.total !== null) {
    const lineDiff = Math.abs(lineSum - e.total);
    const aiDiff = e.items.length ? Math.abs(itemSum - e.total) : Infinity;
    if (lineDiff < 0.02 && (aiDiff >= 0.02 || lineItems.length > e.items.length)) e.items = lineItems;
  }

  const finalSum = round2(e.items.reduce((s, i) => s + i.totalPrice, 0));
  if (e.items.length === 0 && e.total !== null) {
    e.items.push({ name: e.merchant ? `Einkauf ${e.merchant}` : "Einkauf", quantity: 1, unitPrice: null, totalPrice: e.total });
    review.push("Keine Einzelpositionen erkannt");
  } else if (e.total !== null && Math.abs(finalSum - e.total) > 0.05) {
    review.push(`Summe der Positionen (${finalSum.toFixed(2)}) weicht vom Gesamtbetrag (${e.total.toFixed(2)}) ab`);
  }
  if (!e.date) review.push("Kaufdatum nicht erkannt");
  if (!e.merchant) review.push("Geschäft nicht erkannt");
  if (e.total === null) review.push("Gesamtbetrag nicht erkannt");
  return { extraction: e, review };
}

// Eindeutige Fälle ohne KI: spart Zeit und ist zuverlässiger als ein kleines Modell
const BUILTIN_RULES: [RegExp, string][] = [
  [/\b(pfand|leergut|mehrweg|einweg)\b/i, "Sonstiges > Pfand & Rabatte"],
  [/\b(rabatt|coupon|gutschein|nachlass|preisvorteil|aktionsrabatt)\b/i, "Sonstiges > Pfand & Rabatte"],
  [/\b(versand|versandkosten|lieferung|liefergebühr|anlieferung|montage|anschluss|aufbauservice|servicepauschale|entsorgung|altgerätemitnahme)\b/i, "Sonstiges > Gebühren & Service"],
];

/** Ordnet Kategorien zu: gelernte Regeln, feste Stichworte, dann KI, sonst "Nicht zugeordnet". */
async function assignCategories(ex: Extraction): Promise<ProcessedItem[]> {
  const categories = await getCategories();
  const lookup = buildLookup(categories);
  const rules = new Map(
    (await sql<{ pattern: string; category_id: number }[]>`SELECT pattern, category_id FROM category_rules`).map(
      (r) => [r.pattern, r.category_id],
    ),
  );

  const items: ProcessedItem[] = ex.items.map((it, idx) => ({
    position: idx,
    name: it.name,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    totalPrice: it.totalPrice,
    categoryId: null,
    categorySource: "fallback",
    warrantyMonths: null,
  }));

  const open: { index: number; name: string }[] = [];
  const usedRules: string[] = [];
  for (const item of items) {
    const key = normalizeItemName(item.name);
    const ruleCat = key ? rules.get(key) : undefined;
    const builtin = BUILTIN_RULES.find(([re]) => re.test(item.name));
    const builtinCat = builtin ? resolveCategoryPath(lookup, builtin[1]) : null;
    if (ruleCat && lookup.byId.has(ruleCat)) {
      item.categoryId = ruleCat;
      item.categorySource = "rule";
      usedRules.push(key);
    } else if (builtinCat) {
      item.categoryId = builtinCat;
      item.categorySource = "keyword";
    } else {
      open.push({ index: item.position, name: item.name });
    }
  }

  if (open.length) {
    try {
      const assignments = await categorizeItems(ex.merchant, open, lookup.paths);
      for (const a of assignments) {
        const item = items[a.index];
        if (!item || item.categorySource === "rule") continue;
        const id = resolveCategoryPath(lookup, a.category);
        if (id) {
          item.categoryId = id;
          item.categorySource = "ai";
        }
      }
    } catch (e) {
      console.warn("[verarbeitung] Kategorisierung fehlgeschlagen:", (e as Error).message);
    }
  }

  for (const item of items) {
    if (item.categoryId === null) item.categoryId = lookup.fallbackId;
    const cat = item.categoryId ? lookup.byId.get(item.categoryId) : undefined;
    const catMonths = cat?.default_warranty_months ?? 0;
    // Garantie nur für langlebige Güter verfolgen – festgelegt über die Kategorie
    // (Standard: 24 Monate gesetzliche Gewährleistung für Elektronik, Werkzeug, Möbel …)
    if (item.totalPrice > 0 && catMonths > 0) item.warrantyMonths = catMonths;
  }

  if (usedRules.length) {
    await sql`UPDATE category_rules SET hits = hits + 1 WHERE pattern = ANY(${usedRules})`;
  }
  return items;
}

/** Komplette Verarbeitung eines Belegs. Wirft bei Fehlern. */
export async function processReceipt(receipt: ReceiptRow): Promise<void> {
  const file = await loadFile(receipt.file_path);
  const prepared = await prepare(receipt, file);

  let previewPath = receipt.preview_path;
  if (prepared.preview && !previewPath) previewPath = await saveFile(prepared.preview, "webp");

  // OCR-Text schon mal speichern – so ist der Beleg auch bei KI-Fehlern durchsuchbar
  await sql`UPDATE receipts SET raw_text = ${prepared.text}, preview_path = ${previewPath}, updated_at = now()
            WHERE id = ${receipt.id}`;

  // Passen die regelbasiert gelesenen Zeilen exakt zur Bonsumme, braucht die KI nur noch die Kopfdaten
  const lineItems = parseItemsFromText(prepared.text);
  const textTotal = findTotalInText(prepared.text);
  const linesComplete =
    lineItems.length > 0 &&
    textTotal !== null &&
    Math.abs(round2(lineItems.reduce((s, i) => s + i.totalPrice, 0)) - textTotal) < 0.02;

  let result: { extraction: Extraction; raw: unknown; ctx: AiContext };
  try {
    result = await extractReceipt(prepared.text, prepared.visionImages, linesComplete);
  } catch (e) {
    throw new Error(`KI-Auswertung fehlgeschlagen: ${(e as Error).message}`);
  }
  if (linesComplete) {
    result.extraction.items = lineItems;
    if (result.extraction.total === null) result.extraction.total = textTotal;
  }
  const { extraction, review } = reconcile(result.extraction, prepared.text);
  const items = await assignCategories(extraction);

  await sql.begin(async (tx) => {
    await tx`
      UPDATE receipts SET
        status = 'done',
        merchant = ${extraction.merchant},
        merchant_address = ${extraction.merchantAddress},
        purchase_date = ${extraction.date},
        purchase_time = ${extraction.time},
        total = ${extraction.total},
        currency = ${extraction.currency},
        payment_method = ${extraction.paymentMethod},
        needs_review = ${review.length > 0},
        review_reason = ${review.length ? review.join("; ") : null},
        ai_provider = ${result.ctx.provider},
        ai_model = ${result.ctx.model},
        ai_response = ${tx.json(result.raw as never)},
        error = NULL,
        processed_at = now(),
        updated_at = now()
      WHERE id = ${receipt.id}`;
    await tx`DELETE FROM receipt_items WHERE receipt_id = ${receipt.id}`;
    for (const it of items) {
      await tx`
        INSERT INTO receipt_items (receipt_id, position, name, quantity, unit_price, total_price,
                                   category_id, category_source, warranty_months)
        VALUES (${receipt.id}, ${it.position}, ${it.name}, ${it.quantity}, ${it.unitPrice}, ${it.totalPrice},
                ${it.categoryId}, ${it.categorySource}, ${it.warrantyMonths})`;
    }
  });

  // Derselbe Bon schon einmal erfasst? Dann nicht doppelt zählen.
  await checkDuplicate(receipt.id);
}

/** Entfernt einen Beleg inkl. Dateien. */
export async function deleteReceipt(id: string): Promise<void> {
  const [row] = await sql<{ file_path: string; preview_path: string | null }[]>`
    DELETE FROM receipts WHERE id = ${id} RETURNING file_path, preview_path`;
  if (row) {
    await deleteFile(row.file_path);
    await deleteFile(row.preview_path);
  }
}
