// Hilfsfunktionen, um KI-Ausgaben und OCR-Text robust in saubere Werte zu überführen.
// Kleine lokale Modelle liefern Zahlen oft als "1,99" oder Datumsangaben als "12.03.24" –
// hier wird alles normalisiert und plausibilisiert.

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.trim().replace(/[€\s]|EUR/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^-|-$/.test(s)) {
    negative = true;
    s = s.replace(/^-|-$/g, "");
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // deutsches Format 1.234,56
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    // englisches Format 1,234.56
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += y > 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  // Belege aus der Zukunft oder vor 1990 sind sehr wahrscheinlich Lesefehler
  const tomorrow = Date.now() + 36 * 3600 * 1000;
  if (date.getTime() > tomorrow || y < 1990) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Liefert ein ISO-Datum (JJJJ-MM-TT) oder null. */
export function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  return null;
}

export function parseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  const sec = m[3] ? +m[3] : 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Sucht im OCR-Text nach dem ersten plausiblen Datum. */
export function findDateInText(text: string): string | null {
  const re = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g;
  for (const m of text.matchAll(re)) {
    const d = validDate(+m[3], +m[2], +m[1]);
    if (d) return d;
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso ? validDate(+iso[1], +iso[2], +iso[3]) : null;
}

export function findTimeInText(text: string): string | null {
  const m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  return m ? parseTime(m[0]) : null;
}

const TOTAL_KEYWORDS = /(zu\s*zahlen|gesamtbetrag|summe|gesamt|total|endbetrag|betrag\s*eur|rechnungsbetrag)/i;
const AMOUNT = /-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+\.\d{2}\b/g;

/** Sucht den Gesamtbetrag über typische Schlüsselwörter ("SUMME", "ZU ZAHLEN" …). */
export function findTotalInText(text: string): number | null {
  const lines = text.split(/\r?\n/);
  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!TOTAL_KEYWORDS.test(line) || /zwischensumme|mwst|ust|netto|steuer/i.test(line)) continue;
    let amounts = line.match(AMOUNT);
    // Betrag steht manchmal in der nächsten Zeile
    if (!amounts && i + 1 < lines.length) amounts = lines[i + 1].match(AMOUNT);
    if (amounts) {
      const n = parseNumber(amounts[amounts.length - 1].replace(/\s/g, ""));
      if (n !== null && n > 0) candidates.push(n);
    }
  }
  if (!candidates.length) return null;
  // "Zu zahlen" und "Summe" stehen meist vor Zahlungsdetails – der größte Kandidat ist am robustesten
  return Math.max(...candidates);
}

/** Normalisiert Artikelnamen für gelernte Kategorie-Regeln. */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d+([.,]\d+)?\s*(kg|g|l|ml|cl|st|stk|x|%)?/g, " ")
    .replace(/[^a-z\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Holt das erste JSON-Objekt aus einer Modellantwort (auch wenn es in ```json … ``` steht). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // weiter unten
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // weiter unten
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("Antwort des Modells enthält kein JSON");
}

export interface TextItem {
  name: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number;
}

const STOP_LINE = /^\s*(zu\s*zahlen|summe|gesamt|total|endbetrag|rechnungsbetrag|zwischensumme|betrag)\b/i;
const SKIP_LINE =
  /(uid|ust|steuer|mwst|netto|brutto|tel\.?|fax|datum|uhrzeit|bon-?nr|kasse|filiale|str\.|straße|www\.|e-?mail|iban|bic|terminal|beleg-?nr|trace|genehmigung|kundenbeleg|%\s+\d)/i;
const ITEM_LINE = /^(.*?[A-Za-zÄÖÜäöüß].*?)\s+(-?\s?\d{1,4},\d{2})(\s?-)?(?:\s+[A-Z0-9*]{1,2})?\s*$/;
const QTY_INLINE = /(\d+(?:,\d+)?)\s*(?:stk|st|x)?\s*[x×*]\s*(\d{1,4},\d{2})/i;
const WEIGHT_LINE = /^\s*(\d+,\d{2,3})\s*kg\s*[x×*]\s*(\d{1,4},\d{2})/i;

/**
 * Liest Artikelzeilen ("BANANE   1,79 A") regelbasiert aus dem OCR-Text eines Kassenbons.
 * Dient als Gegenprobe zur KI: Passt die Summe dieser Zeilen exakt zum Gesamtbetrag,
 * ist das Ergebnis sehr zuverlässig – auch wenn ein kleines Modell Positionen übersieht.
 */
export function parseItemsFromText(text: string): TextItem[] {
  const items: TextItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[“”„"]/g, "").trim();
    if (!line) continue;
    if (STOP_LINE.test(line)) break;

    // Mengen-/Gewichtszeile ohne eigenen Artikel ("2 Stk x 1,19" bzw. "0,834 kg x 1,99 EUR/kg")
    const weight = line.match(WEIGHT_LINE);
    const qtyOnly = !ITEM_LINE.test(line.replace(QTY_INLINE, "")) ? line.match(QTY_INLINE) : null;
    if ((weight || qtyOnly) && items.length) {
      const m = (weight ?? qtyOnly)!;
      const prev = items[items.length - 1];
      prev.quantity = parseNumber(m[1]) ?? prev.quantity;
      prev.unitPrice = parseNumber(m[2]);
      continue;
    }

    if (SKIP_LINE.test(line)) continue;
    const m = line.match(ITEM_LINE);
    if (!m) continue;
    let price = parseNumber(m[2].replace(/\s/g, ""));
    if (price === null) continue;
    if (m[3]) price = -Math.abs(price);
    let name = m[1].trim();
    let quantity = 1;
    let unitPrice: number | null = null;
    const inline = name.match(QTY_INLINE);
    if (inline) {
      quantity = parseNumber(inline[1]) ?? 1;
      unitPrice = parseNumber(inline[2]);
      name = name.replace(QTY_INLINE, "").trim();
    }
    // reine Zahlen/Währungszeilen sind keine Artikel
    if (!/[A-Za-zÄÖÜäöüß]{2,}/.test(name) || /^eur$/i.test(name)) continue;
    items.push({ name: name.replace(/\s{2,}/g, " "), quantity, unitPrice, totalPrice: round2(price) });
  }
  return items;
}
