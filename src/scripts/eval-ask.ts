// Entwicklungs-Hilfe: prüft, wie gut das Modell Fragen in Abfragepläne übersetzt.
// Aufruf: OLLAMA_MODEL=qwen2.5:3b npx tsx src/scripts/eval-ask.ts
import { planQuestion } from "../lib/ask";
import type { AskPlan } from "../lib/ask/plan";
import { config } from "../lib/config";
import { sql } from "../lib/db";

type Check = (p: AskPlan) => boolean;
const intent = (i: AskPlan["intent"]): Check => (p) => p.intent === i;
const period = (x: AskPlan["period"], extra: Partial<AskPlan> = {}): Check => (p) =>
  p.period === x && Object.entries(extra).every(([k, v]) => p[k as keyof AskPlan] === v);
const term = (t: string): Check => (p) => p.search_terms.some((s) => s.includes(t));
const cat = (c: string): Check => (p) => p.categories.some((x) => x.includes(c));
const noCat: Check = (p) => p.categories.length === 0;
const merchant = (m: string): Check => (p) => (p.merchant ?? "").includes(m) || p.search_terms.some((s) => s.includes(m));
const group = (g: AskPlan["group_by"]): Check => (p) => p.group_by === g;

const cases: [string, Check[]][] = [
  ["Wie viel haben wir dieses Jahr für Kaffee ausgegeben?", [intent("sum"), period("this_year"), term("kaffee")]],
  ["Was haben wir im August für Essen gezahlt?", [intent("sum"), period("month", { month: 8 }), cat("Lebensmittel")]],
  ["Wie oft waren wir letzten Monat bei Lidl?", [intent("count"), period("last_month"), merchant("lidl")]],
  ["Wann haben wir den Fernseher gekauft?", [intent("list_items"), term("fernseh")]],
  ["Wofür geben wir am meisten Geld aus?", [intent("sum"), group("category")]],
  ["Wie viel geben wir im Schnitt pro Monat für Restaurants aus?", [intent("average_month"), cat("Restaurant")]],
  ["Was haben wir letztes Jahr bei IKEA gekauft?", [period("last_year"), merchant("ikea")]],
  ["Wie viel Geld ist diese Woche draufgegangen?", [intent("sum"), period("this_week"), noCat]],
  ["Zeig mir alle Belege von dm aus dem März", [intent("list_receipts"), period("month", { month: 3 }), merchant("dm")]],
  ["Wie viel haben wir 2025 für Tanken bezahlt?", [intent("sum"), period("year", { year: 2025 }), (p) => cat("Tanken")(p) || term("tank")(p) || term("benzin")(p) || term("diesel")(p)]],
  ["In welchem Monat haben wir am meisten ausgegeben?", [group("month")]],
  ["Bei welchen Geschäften kaufen wir am meisten ein?", [group("merchant")]],
  ["Was kostet uns Bier im Monat?", [intent("average_month"), term("bier")]],
  ["Wie viele Einkäufe hatten wir gestern?", [intent("count"), period("yesterday")]],
  ["Welche Elektronik haben wir in den letzten 12 Monaten gekauft?", [intent("list_items"), period("last_12_months"), cat("Elektronik")]],
  ["Wie viel haben wir heute ausgegeben?", [intent("sum"), period("today")]],
  ["Ausgaben für Drogerie nach Monaten dieses Jahr", [group("month"), period("this_year"), cat("Drogerie")]],
  ["Wie viel Pfand haben wir zurückbekommen?", [(p) => term("pfand")(p) || cat("Pfand")(p)]],
  ["Wie viel haben wir in den letzten 30 Tagen bei Rewe gelassen?", [intent("sum"), period("last_30_days"), merchant("rewe")]],
  ["Welche Artikel kaufen wir am häufigsten?", [group("item")]],
];

let ok = 0;
const t0 = Date.now();
for (const [q, checks] of cases) {
  try {
    const { plan } = await planQuestion(q);
    const failed = checks.map((c, i) => (c(plan) ? null : i)).filter((x) => x !== null);
    if (!failed.length) ok++;
    const short = `${plan.intent}/${plan.group_by}/${plan.period}${plan.month ? `:${plan.month}` : ""}${plan.year ? `:${plan.year}` : ""}` +
      ` t=[${plan.search_terms.slice(0, 3).join(",")}] c=[${plan.categories.join(",")}] m=${plan.merchant ?? "-"}`;
    console.log(`${failed.length ? "✗" : "✓"} ${q.padEnd(62)} ${short}`);
  } catch (e) {
    console.log(`✗ ${q}: FEHLER ${(e as Error).message}`);
  }
}
const provider = config.ai.askProvider || config.ai.provider;
const model = provider === "ollama" ? config.ai.ollama.model : config.ai.openrouter.model;
console.log(`\n${model}: ${ok}/${cases.length} richtig in ${((Date.now() - t0) / 1000).toFixed(0)} s (Ø ${((Date.now() - t0) / 1000 / cases.length).toFixed(1)} s pro Frage)`);
await sql.end();
