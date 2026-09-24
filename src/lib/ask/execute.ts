import type { PendingQuery, Row } from "postgres";
import { sql } from "../db";
import type { AskPlan, DateRange } from "./plan";

// Führt einen Abfrageplan aus. Alle Werte gehen als Parameter in feste Abfragen –
// der Plan kann nur filtern und gruppieren, niemals Daten ändern.

const EFFECTIVE_DATE = sql`COALESCE(r.purchase_date, (r.created_at AT TIME ZONE 'Europe/Berlin')::date)`;

export interface AskGroup {
  label: string;
  total: number;
  receipts: number;
  items: number;
}

export interface AskItem {
  date: string;
  merchant: string | null;
  name: string;
  price: number;
  receipt_id: string;
}

export interface AskReceipt {
  date: string;
  merchant: string | null;
  total: number | null;
  items: number;
  receipt_id: string;
}

export interface AskResult {
  total: number;
  receipts: number;
  items: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Anzahl Monate im Zeitraum (für Durchschnitt) */
  months: number;
  groups: AskGroup[];
  itemList: AskItem[];
  receiptList: AskReceipt[];
}

function like(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function filters(plan: AskPlan, range: DateRange, categoryIds: number[]): PendingQuery<Row[]> {
  const parts: PendingQuery<Row[]>[] = [sql`r.status = 'done'`, sql`r.duplicate_of IS NULL`];
  if (range.from) parts.push(sql`${EFFECTIVE_DATE} >= ${range.from}::date`);
  if (range.to) parts.push(sql`${EFFECTIVE_DATE} <= ${range.to}::date`);
  if (categoryIds.length) {
    parts.push(sql`(c.id = ANY(${categoryIds}) OR c.parent_id = ANY(${categoryIds}))`);
  }
  if (plan.search_terms.length) {
    const patterns = plan.search_terms.map(like);
    // Suchbegriffe treffen Artikelnamen und Notizen – und das Geschäft, falls das Modell es dort einträgt
    parts.push(sql`(i.name ILIKE ANY(${patterns}) OR i.notes ILIKE ANY(${patterns}) OR r.merchant ILIKE ANY(${patterns}))`);
  }
  if (plan.merchant) {
    // "REWE Markt" soll auch bei "rewe" gefunden werden, Leerzeichen/Bindestriche egal
    const compact = plan.merchant.replace(/[^a-z0-9äöüß]/g, "");
    parts.push(sql`regexp_replace(lower(coalesce(r.merchant, '')), '[^a-z0-9äöüß]', '', 'g') LIKE ${like(compact)}`);
  }
  return parts.reduce((acc, p) => sql`${acc} AND ${p}`);
}

const BASE = sql`
  FROM receipt_items i
  JOIN receipts r ON r.id = i.receipt_id
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN categories root ON root.id = COALESCE(c.parent_id, c.id)`;

function groupExpr(group: AskPlan["group_by"]): PendingQuery<Row[]> | null {
  switch (group) {
    case "category":
      return sql`COALESCE(root.icon || ' ', '') || COALESCE(root.name, 'Ohne Kategorie')`;
    case "subcategory":
      return sql`COALESCE(root.name || ' > ' || c.name, root.name, 'Ohne Kategorie')`;
    case "merchant":
      return sql`COALESCE(r.merchant, 'Unbekannt')`;
    case "month":
      return sql`to_char(${EFFECTIVE_DATE}, 'YYYY-MM')`;
    case "item":
      return sql`initcap(lower(i.name))`;
    case "weekday":
      return sql`(ARRAY['Mo','Di','Mi','Do','Fr','Sa','So'])[extract(isodow FROM ${EFFECTIVE_DATE})::int]`;
    default:
      return null;
  }
}

export async function executePlan(plan: AskPlan, range: DateRange, categoryIds: number[]): Promise<AskResult> {
  const where = filters(plan, range, categoryIds);

  const [totals] = await sql<
    { total: string | null; receipts: number; items: number; first: string | null; last: string | null }[]
  >`
    SELECT COALESCE(sum(i.total_price), 0)::text AS total, count(DISTINCT r.id)::int AS receipts,
           count(i.id)::int AS items, min(${EFFECTIVE_DATE})::text AS first, max(${EFFECTIVE_DATE})::text AS last
    ${BASE}
    WHERE ${where}`;

  // Monate für den Durchschnitt: gewählter Zeitraum, bei "insgesamt" vom ersten bis letzten Einkauf
  const from = range.from ?? totals.first;
  const to = range.to ?? totals.last;
  let months = 0;
  if (from && to) {
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    months = (ty - fy) * 12 + (tm - fm) + 1;
  }

  const result: AskResult = {
    total: Number(totals.total ?? 0),
    receipts: totals.receipts,
    items: totals.items,
    firstDate: totals.first,
    lastDate: totals.last,
    months,
    groups: [],
    itemList: [],
    receiptList: [],
  };

  const group = groupExpr(plan.group_by);
  if (group) {
    // "am häufigsten" (Anzahl) → nach Häufigkeit sortieren, sonst nach Betrag
    const order =
      plan.group_by === "month" || plan.group_by === "weekday"
        ? sql`1`
        : plan.intent === "count" || plan.intent === "list_items"
          ? sql`count(i.id) DESC, sum(i.total_price) DESC`
          : sql`sum(i.total_price) DESC`;
    const rows = await sql<{ label: string; total: string; receipts: number; items: number }[]>`
      SELECT ${group} AS label, sum(i.total_price)::text AS total, count(DISTINCT r.id)::int AS receipts,
             count(i.id)::int AS items
      ${BASE}
      WHERE ${where}
      GROUP BY 1
      ORDER BY ${order}
      LIMIT ${plan.group_by === "month" ? 60 : plan.limit}`;
    result.groups = rows.map((g) => ({ ...g, total: Number(g.total) }));
  }

  if (plan.intent === "list_items") {
    const rows = await sql<{ date: string; merchant: string | null; name: string; price: string; receipt_id: string }[]>`
      SELECT ${EFFECTIVE_DATE}::text AS date, r.merchant, i.name, i.total_price::text AS price, r.id AS receipt_id
      ${BASE}
      WHERE ${where}
      ORDER BY ${EFFECTIVE_DATE} DESC, i.total_price DESC
      LIMIT ${plan.limit}`;
    result.itemList = rows.map((x) => ({ ...x, price: Number(x.price) }));
  }

  if (plan.intent === "list_receipts") {
    const rows = await sql<{ date: string; merchant: string | null; total: string | null; items: number; receipt_id: string }[]>`
      SELECT ${EFFECTIVE_DATE}::text AS date, r.merchant, r.total::text AS total, count(i.id)::int AS items,
             r.id AS receipt_id
      ${BASE}
      WHERE ${where}
      GROUP BY r.id
      ORDER BY 1 DESC
      LIMIT ${plan.limit}`;
    result.receiptList = rows.map((x) => ({ ...x, total: x.total === null ? null : Number(x.total) }));
  }

  return result;
}
