// Fragen in normaler Sprache → strukturierter Abfrageplan.
//
// Das Sprachmodell schreibt bewusst KEIN SQL, sondern füllt nur dieses Formular aus
// (Structured Output mit Auswahllisten). Die eigentliche Datenbankabfrage baut execute.ts
// mit festen, parametrisierten Abfragen. Dadurch kann eine Frage nie Daten ändern und
// auch ein kleines lokales Modell liefert verlässlich gültige Pläne.

export const INTENTS = ["sum", "count", "average_month", "list_items", "list_receipts"] as const;
export const GROUPS = ["none", "category", "subcategory", "merchant", "month", "item", "weekday"] as const;
export const PERIODS = [
  "all",
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "last_30_days",
  "last_12_months",
  "month",
  "year",
  "custom",
] as const;

export type Intent = (typeof INTENTS)[number];
export type GroupBy = (typeof GROUPS)[number];
export type Period = (typeof PERIODS)[number];

export interface AskPlan {
  intent: Intent;
  group_by: GroupBy;
  period: Period;
  /** bei period = month/year */
  month: number | null;
  year: number | null;
  /** bei period = custom (JJJJ-MM-TT) */
  date_from: string | null;
  date_to: string | null;
  /** Artikel-Suchbegriffe inkl. Synonyme, z. B. ["kaffee", "espresso", "cappuccino"] */
  search_terms: string[];
  /** Kategorie-Pfade aus der Liste */
  categories: string[];
  merchant: string | null;
  limit: number;
}

export function planSchema(categoryPaths: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "intent",
      "group_by",
      "period",
      "month",
      "year",
      "date_from",
      "date_to",
      "search_terms",
      "categories",
      "merchant",
      "limit",
    ],
    properties: {
      intent: { type: "string", enum: [...INTENTS] },
      group_by: { type: "string", enum: [...GROUPS] },
      period: { type: "string", enum: [...PERIODS] },
      month: { type: ["integer", "null"] },
      year: { type: ["integer", "null"] },
      date_from: { type: ["string", "null"] },
      date_to: { type: ["string", "null"] },
      search_terms: { type: "array", items: { type: "string" }, maxItems: 8 },
      categories: { type: "array", items: { type: "string", enum: categoryPaths }, maxItems: 6 },
      merchant: { type: ["string", "null"] },
      limit: { type: "integer" },
    },
  };
}

export function planSystemPrompt(today: string, categoryPaths: string[]): string {
  return `Du übersetzt Fragen zu Haushaltsausgaben in einen Abfrageplan (nur JSON). Heute ist ${today}.

Felder:
- intent: "sum" (wie viel ausgegeben), "count" (wie oft / wie viele Einkäufe), "average_month" (im Schnitt pro Monat),
  "list_items" (welche Artikel, wann gekauft, was gekostet), "list_receipts" (welche Belege/Einkäufe zeigen)
- group_by: Aufteilung nach "category", "subcategory", "merchant" (Geschäft), "month", "item" (Artikel), "weekday" oder "none"
- period: Zeitraum. "today" = heute, "yesterday" = gestern, "month" mit month (1-12) und optional year,
  "year" mit year, "custom" nur mit date_from/date_to (JJJJ-MM-TT). Ohne Zeitangabe: "all".
- search_terms: Produkte aus der Frage in Kleinbuchstaben plus typische Varianten/Marken, wie sie auf Kassenbons stehen.
  Leer lassen, wenn nach einer ganzen Kategorie oder einem Geschäft gefragt wird.
- categories: nur wenn nach einer Ausgabenart gefragt wird, exakt aus der Liste unten. Sonst leer.
- merchant: Name des Geschäfts, falls genannt (z. B. "rewe", "ikea"), sonst null.
- limit: Anzahl Einträge bei Listen/Aufteilungen, Standard 10.

Beispiele:
"Wie viel haben wir dieses Jahr für Kaffee ausgegeben?"
{"intent":"sum","group_by":"none","period":"this_year","month":null,"year":null,"date_from":null,"date_to":null,"search_terms":["kaffee","espresso","cappuccino","latte","crema","bohnen"],"categories":[],"merchant":null,"limit":10}
"Was haben wir im August für Essen gezahlt?"
{"intent":"sum","group_by":"category","period":"month","month":8,"year":null,"date_from":null,"date_to":null,"search_terms":[],"categories":["Lebensmittel","Restaurant & Café"],"merchant":null,"limit":10}
"Wie oft waren wir letzten Monat bei Lidl?"
{"intent":"count","group_by":"none","period":"last_month","month":null,"year":null,"date_from":null,"date_to":null,"search_terms":[],"categories":[],"merchant":"lidl","limit":10}
"Wann haben wir die Waschmaschine gekauft?"
{"intent":"list_items","group_by":"none","period":"all","month":null,"year":null,"date_from":null,"date_to":null,"search_terms":["waschmaschine","waschvollautomat"],"categories":[],"merchant":null,"limit":10}
"Wofür geben wir am meisten aus?"
{"intent":"sum","group_by":"category","period":"last_12_months","month":null,"year":null,"date_from":null,"date_to":null,"search_terms":[],"categories":[],"merchant":null,"limit":10}
"Was haben wir 2025 für Tanken bezahlt?"
{"intent":"sum","group_by":"none","period":"year","month":null,"year":2025,"date_from":null,"date_to":null,"search_terms":[],"categories":["Mobilität > Tanken & Laden"],"merchant":null,"limit":10}
"Wie viel geben wir im Schnitt pro Monat für Drogerie aus?"
{"intent":"average_month","group_by":"none","period":"last_12_months","month":null,"year":null,"date_from":null,"date_to":null,"search_terms":[],"categories":["Drogerie & Körperpflege"],"merchant":null,"limit":10}

Kategorien:
${categoryPaths.join("\n")}`;
}

// ---------- Plan prüfen und Zeitraum auflösen ----------

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

function isoDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Macht aus einer (evtl. unvollständigen) Modellantwort einen gültigen Plan. */
export function normalizePlan(raw: unknown, validCategories: Set<string>): AskPlan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const month = int(o.month);
  const terms = Array.isArray(o.search_terms)
    ? [...new Set(o.search_terms.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()))]
        .filter((t) => t.length >= 2)
        .slice(0, 8)
    : [];
  const merchant = typeof o.merchant === "string" && o.merchant.trim() ? o.merchant.trim().toLowerCase() : null;
  const limit = int(o.limit);
  return {
    intent: oneOf(INTENTS, o.intent, "sum"),
    group_by: oneOf(GROUPS, o.group_by, "none"),
    period: oneOf(PERIODS, o.period, "all"),
    month: month && month >= 1 && month <= 12 ? month : null,
    year: int(o.year),
    date_from: isoDate(o.date_from),
    date_to: isoDate(o.date_to),
    search_terms: terms,
    categories: Array.isArray(o.categories)
      ? o.categories.filter((c): c is string => typeof c === "string" && validCategories.has(c)).slice(0, 6)
      : [],
    merchant,
    limit: limit && limit > 0 ? Math.min(limit, 50) : 10,
  };
}

export interface DateRange {
  from: string | null;
  to: string | null;
  /** z. B. "dieses Jahr (01.01.2026 – 24.09.2026)" */
  label: string;
}

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function de(isoStr: string): string {
  const [y, m, d] = isoStr.split("-");
  return `${d}.${m}.${y}`;
}

/** Löst den Zeitraum des Plans in konkrete Daten auf (today = JJJJ-MM-TT). */
export function resolvePeriod(plan: AskPlan, today: string): DateRange {
  const t = new Date(`${today}T00:00:00Z`);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const day = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  const range = (from: Date, to: Date, name: string): DateRange => ({
    from: iso(from),
    to: iso(to),
    label: `${name} (${de(iso(from))} – ${de(iso(to))})`,
  });
  const weekday = (t.getUTCDay() + 6) % 7; // Montag = 0

  switch (plan.period) {
    case "today":
      return range(t, t, "heute");
    case "yesterday":
      return range(day(y, m, t.getUTCDate() - 1), day(y, m, t.getUTCDate() - 1), "gestern");
    case "this_week":
      return range(day(y, m, t.getUTCDate() - weekday), t, "diese Woche");
    case "last_week":
      return range(day(y, m, t.getUTCDate() - weekday - 7), day(y, m, t.getUTCDate() - weekday - 1), "letzte Woche");
    case "this_month":
      return range(day(y, m, 1), t, "diesen Monat");
    case "last_month":
      return range(day(y, m - 1, 1), day(y, m, 0), "letzten Monat");
    case "this_year":
      return range(day(y, 0, 1), t, "dieses Jahr");
    case "last_year":
      return range(day(y - 1, 0, 1), day(y - 1, 11, 31), "letztes Jahr");
    case "last_30_days":
      return range(day(y, m, t.getUTCDate() - 29), t, "in den letzten 30 Tagen");
    case "last_12_months":
      return range(day(y, m - 11, 1), t, "in den letzten 12 Monaten");
    case "month": {
      if (!plan.month) break;
      // Ohne Jahr: der letzte vergangene bzw. laufende Monat mit diesem Namen
      const year = plan.year ?? (plan.month - 1 > m ? y - 1 : y);
      const end = day(year, plan.month, 0);
      return range(day(year, plan.month - 1, 1), end > t ? t : end, `im ${MONTHS[plan.month - 1]} ${year}`);
    }
    case "year": {
      if (!plan.year) break;
      const end = day(plan.year, 11, 31);
      return range(day(plan.year, 0, 1), end > t ? t : end, `im Jahr ${plan.year}`);
    }
    case "custom": {
      if (!plan.date_from && !plan.date_to) break;
      const from = plan.date_from ?? "2000-01-01";
      const to = plan.date_to ?? today;
      return { from, to, label: `vom ${de(from)} bis ${de(to)}` };
    }
  }
  return { from: null, to: null, label: "insgesamt" };
}

// ---------- Regelbasierte Korrekturen ----------
// Zeitangaben und "pro Monat" erkennt ein fester Regelsatz zuverlässiger als ein kleines Modell.

const MONTH_PATTERNS: [RegExp, number][] = [
  [/januar|jänner/, 1],
  [/februar/, 2],
  [/märz|maerz/, 3],
  [/april/, 4],
  [/\bmai\b/, 5],
  [/juni/, 6],
  [/juli/, 7],
  [/august/, 8],
  [/september/, 9],
  [/oktober/, 10],
  [/november/, 11],
  [/dezember/, 12],
];

const PERIOD_PATTERNS: [RegExp, Period][] = [
  [/\bheute\b/, "today"],
  [/\bgestern\b/, "yesterday"],
  [/\b(diese[rn]?|der) woche\b/, "this_week"],
  [/\b(letzte[rn]?|vorige[rn]?|vergangene[rn]?) woche\b/, "last_week"],
  [/\b(diese[nm]?|laufende[nm]?) monat\b/, "this_month"],
  [/\b(letzte[nm]?|vorige[nm]?|vergangene[nm]?) monat\b|\bvormonat\b/, "last_month"],
  [/\b(dieses|diesem|laufende[nm]?) jahr\b/, "this_year"],
  [/\b(letzte[sm]?|vorige[sm]?|vergangene[nm]?) jahr\b|\bvorjahr\b/, "last_year"],
  [/\b(letzte[nm]?|vergangene[nm]?) 30 tage/, "last_30_days"],
  [/\b(letzte[nm]?|vergangene[nm]?) 12 monate|\bletzte[nm]? jahr über\b/, "last_12_months"],
];

// Wörter, die keine Produkte sind und als Suchbegriff nur Treffer verhindern
const STOP_TERMS = new Set([
  "heute", "gestern", "woche", "monat", "monate", "jahr", "einkauf", "einkäufe", "einkaufen", "ausgaben",
  "ausgegeben", "geld", "kosten", "kostet", "gekauft", "beleg", "belege", "artikel", "alles", "insgesamt",
]);

/**
 * Korrigiert den Plan anhand der Originalfrage:
 * - eindeutige Zeitangaben ("gestern", "im März 2025", "2024") überstimmen das Modell
 * - "pro Monat" / "im Schnitt" → Durchschnitt pro Monat
 * - Suchbegriffe ohne Aussagekraft entfernen, Geschäftsname nicht zusätzlich als Suchbegriff
 * - Suchbegriffe UND Kategorien: Ist der Suchbegriff der Kategoriename ("Elektronik"), wird nach Kategorie
 *   gefiltert, sonst nach dem Produkt ("Bier" – die Kategorie war dann nur geraten)
 */
export function refinePlan(plan: AskPlan, question: string): AskPlan {
  const q = question.toLowerCase();
  const p: AskPlan = { ...plan, search_terms: [...plan.search_terms], categories: [...plan.categories] };

  const monthMatch = MONTH_PATTERNS.find(([re]) => re.test(q));
  const yearMatch = q.match(/\b(20\d{2})\b/);
  const periodMatch = PERIOD_PATTERNS.find(([re]) => re.test(q));
  if (periodMatch) {
    p.period = periodMatch[1];
  } else if (monthMatch) {
    p.period = "month";
    p.month = monthMatch[1];
    p.year = yearMatch ? Number(yearMatch[1]) : null;
  } else if (yearMatch && !/\b(seit|von|ab|bis)\b/.test(q)) {
    p.period = "year";
    p.year = Number(yearMatch[1]);
  }

  if (/\b(pro|im|je|jeden|jede[nm]?) monat\b|monatlich|im schnitt|durchschnitt/.test(q) && p.intent === "sum" && p.group_by === "none") {
    p.intent = "average_month";
    // "im Monat" ist hier keine Zeitangabe
    if (!periodMatch || periodMatch[1] === "this_month" || periodMatch[1] === "last_month") {
      if (!/\b(letzte[nm]?|diese[nm]?|vorige[nm]?) monat\b/.test(q)) p.period = monthMatch || yearMatch ? p.period : "last_12_months";
    }
  }

  const merchant = p.merchant?.replace(/[^a-z0-9äöüß]/g, "") ?? "";
  p.search_terms = p.search_terms.filter((t) => {
    const compact = t.replace(/[^a-z0-9äöüß]/g, "");
    return !STOP_TERMS.has(t) && !(merchant && compact === merchant) && !/^\d+$/.test(t);
  });

  if (p.search_terms.length && p.categories.length) {
    const catText = p.categories.join(" ").toLowerCase();
    const termIsCategory = p.search_terms.some((t) => t.length >= 4 && catText.includes(t.slice(0, Math.min(t.length, 6))));
    if (termIsCategory) p.search_terms = [];
    else p.categories = [];
  }
  return p;
}
