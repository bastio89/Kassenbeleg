// Prompts und JSON-Schemas. Bewusst kurz und eindeutig gehalten, damit auch kleine
// lokale Modelle (3B Parameter) zuverlässig antworten.

export const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["merchant", "merchant_address", "date", "time", "total", "currency", "payment_method", "items"],
  properties: {
    merchant: { type: ["string", "null"] },
    merchant_address: { type: ["string", "null"] },
    date: { type: ["string", "null"], description: "Kaufdatum im Format JJJJ-MM-TT" },
    time: { type: ["string", "null"], description: "Uhrzeit HH:MM" },
    total: { type: ["number", "null"] },
    currency: { type: "string" },
    payment_method: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit_price", "total_price"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: ["number", "null"] },
          total_price: { type: "number" },
        },
      },
    },
  },
} as const;

export const EXTRACTION_SYSTEM = `Du liest Kassenbons und Rechnungen aus und antwortest ausschließlich mit JSON.
Regeln:
- merchant: Name des Geschäfts (z. B. "REWE", "dm-drogerie markt", "MediaMarkt"), ohne Rechtsform-Zusätze wie GmbH.
- merchant_address: Straße und Ort, falls vorhanden, sonst null.
- date: Kaufdatum als JJJJ-MM-TT. time: Uhrzeit als HH:MM. Unbekannt = null.
- total: Endbetrag, der bezahlt wurde (z. B. "SUMME", "ZU ZAHLEN", "Gesamtbetrag"), als Zahl mit Punkt als Dezimaltrennzeichen.
- currency: ISO-Code, meistens "EUR".
- payment_method: z. B. "Bar", "EC-Karte", "Kreditkarte", "PayPal" oder null.
- items: JEDE gekaufte Position einzeln. name so wie auf dem Beleg, aber Abkürzungen verständlich lassen.
  quantity: Menge (Standard 1; bei Gewichtsartikeln das Gewicht in kg). unit_price: Einzelpreis oder null.
  total_price: Positionsbetrag. Rabatte, Coupons und Pfandrückgaben als eigene Position mit negativem Betrag.
- NICHT als Position: Zwischensumme, Summe, MwSt-Aufstellung, Zahlungsbeträge, Rückgeld, Kartendaten.
- Erfinde nichts. Was nicht lesbar ist, ist null.`;

// Nur Kopfdaten – wenn die Positionen bereits sicher aus dem OCR-Text gelesen wurden
export const headerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["merchant", "merchant_address", "date", "time", "total", "currency", "payment_method"],
  properties: Object.fromEntries(
    Object.entries(extractionSchema.properties).filter(([k]) => k !== "items"),
  ),
};

export const HEADER_SYSTEM = `Du liest die Kopfdaten eines Kassenbons oder einer Rechnung aus und antwortest ausschließlich mit JSON.
- merchant: Name des Geschäfts (z. B. "REWE", "dm-drogerie markt", "MediaMarkt"), ohne Rechtsform-Zusätze wie GmbH.
- merchant_address: Straße und Ort, falls vorhanden, sonst null.
- date: Kaufdatum als JJJJ-MM-TT. time: Uhrzeit als HH:MM. Unbekannt = null.
- total: bezahlter Endbetrag als Zahl mit Punkt als Dezimaltrennzeichen.
- currency: ISO-Code, meistens "EUR".
- payment_method: z. B. "Bar", "EC-Karte", "Kreditkarte", "PayPal" oder null.
- Erfinde nichts. Was nicht lesbar ist, ist null.`;

export function extractionUserPrompt(text: string, hasImage: boolean): string {
  if (!text) return "Lies den Kassenbon auf dem Bild aus.";
  return hasImage
    ? `Lies den Kassenbon auf dem Bild aus. Zur Hilfe der per OCR erkannte (fehlerhafte) Text:\n\n${text}`
    : `Lies diesen Beleg aus (Text per OCR bzw. aus PDF, kann Fehler enthalten):\n\n${text}`;
}

export function categorizationSchema(categoryPaths: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["category"],
    properties: {
      category: { type: "string", enum: categoryPaths },
    },
  };
}

// Ein Artikel pro Anfrage: kleine Modelle verwechseln bei Listen sonst die Zuordnung.
// Der System-Prompt (inkl. Kategorienliste) ist für alle Artikel identisch und wird von
// Ollama zwischengespeichert – pro Artikel muss nur die kurze Nutzer-Nachricht verarbeitet werden.
export function categorizationSystem(categoryPaths: string[]): string {
  return `Du ordnest einen Artikel von einem deutschen Kassenbon oder einer Rechnung einer Ausgabenkategorie zu und antwortest nur mit JSON.
Artikelnamen sind oft abgekürzt oder in Großbuchstaben (z. B. "HAEHN.BRUSTF." = Hähnchenbrustfilet).
Überlege, was für ein Produkt es ist, und wähle die passendste Kategorie exakt aus der Liste.

Beispiele:
BANANE → Lebensmittel > Obst & Gemüse
H-MILCH 1,5% → Lebensmittel > Milchprodukte & Eier
BUTTER → Lebensmittel > Milchprodukte & Eier
GOUDA SCHEIBEN → Lebensmittel > Milchprodukte & Eier
SALAMI → Lebensmittel > Fleisch, Wurst & Fisch
TOAST / ROGGENBROT / BRÖTCHEN → Lebensmittel > Brot & Backwaren
SPAGHETTI → Lebensmittel > Grundnahrungsmittel
TK PIZZA → Lebensmittel > Tiefkühlkost
CHIPS → Lebensmittel > Süßwaren & Snacks
MINERALWASSER → Lebensmittel > Getränke
RIESLING → Lebensmittel > Alkohol
ZAHNPASTA → Drogerie & Körperpflege > Körperpflege
WINDELN → Drogerie & Körperpflege > Babybedarf
KUECHENROLLE / TOILETTENPAPIER → Drogerie & Körperpflege > Hygieneartikel
WASCHMITTEL → Haushalt > Reinigungsmittel
HDMI KABEL → Elektronik > Kabel & Kleinteile
KAFFEEVOLLAUTOMAT / WASCHMASCHINE → Elektronik > Haushaltsgeräte
AKKUSCHRAUBER / BOHRMASCHINE → Baumarkt & Garten > Werkzeug & Maschinen
DIESEL / SUPER E5 → Mobilität > Tanken & Laden
PFAND / LEERGUT / RABATT → Sonstiges > Pfand & Rabatte
VERSANDKOSTEN / LIEFERUNG / MONTAGE → Sonstiges > Gebühren & Service

Kategorien:
${categoryPaths.join("\n")}`;
}

export function categorizationUserPrompt(merchant: string | null, item: string): string {
  return `Geschäft: ${merchant ?? "unbekannt"}\nArtikel: ${item}`;
}
