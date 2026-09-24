import { config, effectiveMode, type AiProvider } from "../config";
import { parseDate, parseNumber, parseTime, extractJson, round2 } from "../parse";
import { ollama } from "./ollama";
import { openrouter } from "./openrouter";
import {
  categorizationSystem,
  EXTRACTION_SYSTEM,
  HEADER_SYSTEM,
  categorizationSchema,
  categorizationUserPrompt,
  extractionSchema,
  extractionUserPrompt,
  headerSchema,
} from "./prompts";
import type { CategoryAssignment, ExtractedItem, Extraction, LlmClient } from "./types";

const clients: Record<AiProvider, LlmClient> = { ollama, openrouter };

export interface AiContext {
  provider: AiProvider;
  model: string;
}

/** Reihenfolge der Anbieter: primär, dann ggf. Fallback. */
function providerChain(primary: AiProvider = config.ai.provider): LlmClient[] {
  const chain = [clients[primary] ?? ollama];
  const fb = config.ai.fallback;
  if (fb && fb !== chain[0].provider && clients[fb]?.isConfigured()) chain.push(clients[fb]);
  return chain;
}

export async function withFallback<T>(
  fn: (client: LlmClient) => Promise<T>,
  primary?: AiProvider,
): Promise<{ result: T; client: LlmClient }> {
  const errors: string[] = [];
  for (const client of providerChain(primary)) {
    try {
      return { result: await fn(client), client };
    } catch (e) {
      errors.push(`${client.provider}: ${(e as Error).message}`);
      console.warn(`[ai] ${client.provider} fehlgeschlagen:`, (e as Error).message);
    }
  }
  throw new Error(errors.join(" | "));
}

/** Entfernt Rechtsform-Zusätze: "MediaMarkt E-Business GmbH" → "MediaMarkt E-Business". */
export function cleanMerchant(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/\s*(&\s*Co\.?\s*)?(GmbH|AG|KG|KGaA|SE|OHG|oHG|e\.\s?K\.|UG|mbH|Ltd\.?|Inc\.?)(\s*&\s*Co\.?\s*(KG|oHG|OHG))?\.?\s*$/i, "")
    .replace(/[\s,]+$/, "")
    .trim();
  return (cleaned || name).slice(0, 200);
}

export function normalizeExtraction(raw: unknown): Extraction {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const items: ExtractedItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const name = str(r.name);
    let quantity = parseNumber(r.quantity) ?? 1;
    if (quantity === 0) quantity = 1;
    const unitPrice = parseNumber(r.unit_price);
    let totalPrice = parseNumber(r.total_price);
    if (totalPrice === null && unitPrice !== null) totalPrice = round2(unitPrice * quantity);
    if (!name || totalPrice === null) continue;
    items.push({ name: name.slice(0, 300), quantity, unitPrice, totalPrice: round2(totalPrice) });
  }
  const total = parseNumber(o.total);
  return {
    merchant: cleanMerchant(str(o.merchant)),
    merchantAddress: str(o.merchant_address)?.slice(0, 300) ?? null,
    date: parseDate(o.date),
    time: parseTime(o.time),
    total: total === null ? null : round2(total),
    currency: (str(o.currency) ?? "EUR").toUpperCase().slice(0, 3),
    paymentMethod: str(o.payment_method)?.slice(0, 50) ?? null,
    items,
  };
}

/**
 * Schritt 1: Belegdaten und Positionen auslesen.
 * headerOnly: Positionen sind bereits bekannt – nur Geschäft, Datum usw. abfragen (viel schneller).
 */
export async function extractReceipt(
  text: string,
  visionImages: Buffer[],
  headerOnly = false,
): Promise<{ extraction: Extraction; raw: unknown; ctx: AiContext }> {
  const { result, client } = await withFallback(async (client) => {
    const mode = visionImages.length && !headerOnly ? effectiveMode(client.provider) : "ocr";
    const images = mode === "vision" ? visionImages : [];
    if (mode === "ocr" && !text.trim()) throw new Error("Kein Text erkannt – Beleg unleserlich?");
    const res = await client.chat({
      system: headerOnly ? HEADER_SYSTEM : EXTRACTION_SYSTEM,
      user: extractionUserPrompt(text.slice(0, 12000), images.length > 0),
      images,
      schema: (headerOnly ? headerSchema : extractionSchema) as unknown as Record<string, unknown>,
      schemaName: headerOnly ? "receipt_header" : "receipt",
      mode,
    });
    const raw = extractJson(res.content);
    return { raw, model: res.model };
  });
  return {
    extraction: normalizeExtraction(result.raw),
    raw: result.raw,
    ctx: { provider: client.provider, model: result.model },
  };
}

/**
 * Schritt 2: Artikel Kategorien zuordnen – ein Artikel pro Anfrage (siehe prompts.ts).
 * Gleiche Artikelnamen auf einem Beleg werden nur einmal abgefragt.
 */
export async function categorizeItems(
  merchant: string | null,
  items: { index: number; name: string }[],
  categoryPaths: string[],
): Promise<CategoryAssignment[]> {
  const system = categorizationSystem(categoryPaths);
  const schema = categorizationSchema(categoryPaths);
  const cache = new Map<string, string>();
  const out: CategoryAssignment[] = [];
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    let category = cache.get(key);
    if (!category) {
      const { result } = await withFallback(async (client) => {
        const res = await client.chat({
          system,
          user: categorizationUserPrompt(merchant, item.name),
          schema,
          schemaName: "category",
          mode: "ocr",
        });
        const raw = extractJson(res.content) as { category?: unknown };
        if (typeof raw.category !== "string") throw new Error("Ungültige Kategorisierung");
        return raw.category;
      });
      category = result;
      cache.set(key, category);
    }
    out.push({ index: item.index, category });
  }
  return out;
}
