import { withFallback } from "../ai";
import { buildTree, getCategories } from "../categories";
import { config } from "../config";
import { dateDe, eur, monthName, todayIso } from "../format";
import { extractJson } from "../parse";
import { executePlan, type AskResult } from "./execute";
import { normalizePlan, planSchema, planSystemPrompt, refinePlan, resolvePeriod, type AskPlan, type DateRange } from "./plan";

export interface AnswerLine {
  text: string;
  value?: string;
  receiptId?: string;
}

export interface Answer {
  question: string;
  headline: string;
  lines: AnswerLine[];
  /** Wie die Frage verstanden wurde – damit man Fehlinterpretationen erkennt */
  understood: string;
  plan: AskPlan;
  model: string;
  seconds: number;
}

const INTENT_LABEL: Record<AskPlan["intent"], string> = {
  sum: "Summe",
  count: "Anzahl Einkäufe",
  average_month: "Durchschnitt pro Monat",
  list_items: "Artikelliste",
  list_receipts: "Belegliste",
};

const GROUP_LABEL: Record<AskPlan["group_by"], string> = {
  none: "",
  category: "Kategorie",
  subcategory: "Unterkategorie",
  merchant: "Geschäft",
  month: "Monat",
  item: "Artikel",
  weekday: "Wochentag",
};

/** Kategorie-Auswahl für die KI: Hauptkategorien und "Haupt > Unter". */
async function categoryChoices() {
  const tree = buildTree(await getCategories());
  const byPath = new Map<string, number>();
  for (const root of tree) {
    byPath.set(root.name, root.id);
    for (const c of root.children) byPath.set(`${root.name} > ${c.name}`, c.id);
  }
  return byPath;
}

export async function planQuestion(question: string): Promise<{ plan: AskPlan; model: string; categoryIds: number[] }> {
  const byPath = await categoryChoices();
  const paths = [...byPath.keys()];
  const today = todayIso();
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("de-DE", { weekday: "long", timeZone: "UTC" });
  const { result } = await withFallback(async (client) => {
    const res = await client.chat({
      system: planSystemPrompt(`${weekday}, ${today}`, paths),
      user: question.slice(0, 500),
      schema: planSchema(paths),
      schemaName: "ask_plan",
      mode: "ocr",
    });
    return { raw: extractJson(res.content), model: res.model };
  }, config.ai.askProvider || undefined);
  const plan = refinePlan(normalizePlan(result.raw, new Set(paths)), question);
  return { plan, model: result.model, categoryIds: plan.categories.map((c) => byPath.get(c)!).filter(Boolean) };
}

function subject(plan: AskPlan): string {
  const parts: string[] = [];
  if (plan.search_terms.length) parts.push(`„${plan.search_terms[0]}“`);
  if (plan.categories.length) parts.push(plan.categories.map((c) => c.split(" > ").pop()).join(", "));
  const what = parts.length ? `für ${parts.join(" / ")}` : "";
  const where = plan.merchant ? `bei ${plan.merchant.charAt(0).toUpperCase()}${plan.merchant.slice(1)}` : "";
  return [what, where].filter(Boolean).join(" ") || "insgesamt";
}

function understood(plan: AskPlan, range: DateRange): string {
  const parts = [INTENT_LABEL[plan.intent], range.label];
  if (plan.search_terms.length) parts.push(`Suche: ${plan.search_terms.join(", ")}`);
  if (plan.categories.length) parts.push(`Kategorien: ${plan.categories.join(", ")}`);
  if (plan.merchant) parts.push(`Geschäft: ${plan.merchant}`);
  if (plan.group_by !== "none") parts.push(`aufgeteilt nach ${GROUP_LABEL[plan.group_by]}`);
  return parts.join(" · ");
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildAnswer(plan: AskPlan, range: DateRange, r: AskResult): Omit<Answer, "question" | "model" | "seconds"> {
  const when = capitalize(range.label);
  const base = { understood: understood(plan, range), plan };
  // "Insgesamt: 645 € insgesamt" vermeiden
  const what = subject(plan) === "insgesamt" && !range.from ? "ausgegeben" : subject(plan);

  if (r.items === 0) {
    const s = subject(plan);
    return { ...base, headline: `${when}: keine passenden Einkäufe gefunden${s === "insgesamt" ? "" : ` (${s})`}.`, lines: [] };
  }

  let headline: string;
  switch (plan.intent) {
    case "count":
      headline = `${when}: ${r.receipts} ${r.receipts === 1 ? "Einkauf" : "Einkäufe"} ${what} – zusammen ${eur(r.total)}.`;
      break;
    case "average_month": {
      const avg = r.months ? r.total / r.months : r.total;
      headline = `${when}: im Schnitt ${eur(avg)} pro Monat ${what} (gesamt ${eur(r.total)} in ${r.months} ${r.months === 1 ? "Monat" : "Monaten"}).`;
      break;
    }
    case "list_items":
      headline = `${when}: ${r.items} ${r.items === 1 ? "passender Artikel" : "passende Artikel"} ${what}, zusammen ${eur(r.total)}.`;
      break;
    case "list_receipts":
      headline = `${when}: ${r.receipts} ${r.receipts === 1 ? "Beleg" : "Belege"} ${what}, zusammen ${eur(r.total)}.`;
      break;
    default:
      headline = `${when}: ${eur(r.total)} ${what} – ${r.items} Artikel auf ${r.receipts} ${r.receipts === 1 ? "Beleg" : "Belegen"}.`;
  }

  const lines: AnswerLine[] = [];
  if (r.groups.length) {
    const sum = r.groups.reduce((s, g) => s + Math.max(0, g.total), 0) || 1;
    for (const g of r.groups) {
      const label = plan.group_by === "month" ? monthName(g.label) : g.label;
      lines.push({ text: label, value: `${eur(g.total)} · ${Math.round((g.total / sum) * 100)} %` });
    }
  }
  for (const it of r.itemList) {
    lines.push({ text: `${dateDe(it.date)} · ${it.name}${it.merchant ? ` (${it.merchant})` : ""}`, value: eur(it.price), receiptId: it.receipt_id });
  }
  for (const rc of r.receiptList) {
    lines.push({
      text: `${dateDe(rc.date)} · ${rc.merchant ?? "Unbekannt"} · ${rc.items} Artikel`,
      value: rc.total === null ? "–" : eur(rc.total),
      receiptId: rc.receipt_id,
    });
  }
  return { ...base, headline, lines };
}

/** Beantwortet eine Frage in normaler Sprache. */
export async function ask(question: string): Promise<Answer> {
  const t0 = Date.now();
  const { plan, model, categoryIds } = await planQuestion(question);
  const range = resolvePeriod(plan, todayIso());
  const result = await executePlan(plan, range, categoryIds);
  return {
    question,
    model,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    ...buildAnswer(plan, range, result),
  };
}

/** Klartext für Telegram. */
export function answerText(a: Answer): string {
  const lines = a.lines.slice(0, 15).map((l) => `• ${l.text}${l.value ? `: ${l.value}` : ""}`);
  return [
    `💬 ${a.headline}`,
    lines.length ? `\n${lines.join("\n")}` : "",
    `\n🧠 Verstanden als: ${a.understood}`,
  ]
    .filter(Boolean)
    .join("\n");
}
