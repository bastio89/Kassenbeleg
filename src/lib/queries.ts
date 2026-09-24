import type { PendingQuery, Row } from "postgres";
import { sql } from "./db";

// Kaufdatum; falls nicht erkannt, das Upload-Datum
const EFFECTIVE_DATE = sql`COALESCE(r.purchase_date, (r.created_at AT TIME ZONE 'Europe/Berlin')::date)`;

export interface ReceiptListItem {
  id: string;
  status: string;
  merchant: string | null;
  purchase_date: string | null;
  effective_date: string;
  total: string | null;
  currency: string;
  needs_review: boolean;
  preview_path: string | null;
  mime_type: string;
  item_count: number;
  matched_items: string[] | null;
  categories: { name: string; icon: string | null; color: string | null }[] | null;
  error: string | null;
  duplicate_of: string | null;
  source: string;
  uploaded_by: string | null;
  created_at: Date;
}

export interface ReceiptFilter {
  q?: string;
  categoryId?: number;
  from?: string;
  to?: string;
  status?: string;
  review?: boolean;
  limit?: number;
  offset?: number;
}

function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function whereClause(f: ReceiptFilter): PendingQuery<Row[]> {
  const parts: PendingQuery<Row[]>[] = [sql`TRUE`];
  for (const term of searchTerms(f.q)) {
    const p = likePattern(term);
    parts.push(sql`(
      r.merchant ILIKE ${p} OR r.notes ILIKE ${p} OR r.raw_text ILIKE ${p} OR r.original_filename ILIKE ${p}
      OR EXISTS (SELECT 1 FROM receipt_items i WHERE i.receipt_id = r.id AND (i.name ILIKE ${p} OR i.notes ILIKE ${p}))
    )`);
  }
  if (f.categoryId) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM receipt_items i JOIN categories c ON c.id = i.category_id
      WHERE i.receipt_id = r.id AND (c.id = ${f.categoryId} OR c.parent_id = ${f.categoryId}))`);
  }
  if (f.from) parts.push(sql`${EFFECTIVE_DATE} >= ${f.from}::date`);
  if (f.to) parts.push(sql`${EFFECTIVE_DATE} <= ${f.to}::date`);
  if (f.status) parts.push(sql`r.status = ${f.status}`);
  if (f.review) parts.push(sql`(r.needs_review OR r.status = 'failed' OR r.duplicate_of IS NOT NULL)`);
  return parts.reduce((acc, part) => sql`${acc} AND ${part}`);
}

export async function listReceipts(f: ReceiptFilter = {}): Promise<{ rows: ReceiptListItem[]; total: number }> {
  const where = whereClause(f);
  const terms = searchTerms(f.q).map(likePattern);
  const rows = await sql<ReceiptListItem[]>`
    SELECT r.id, r.status, r.merchant, r.purchase_date::text, ${EFFECTIVE_DATE}::text AS effective_date,
           r.total::text, r.currency, r.needs_review, r.preview_path, r.mime_type, r.error, r.source,
           r.uploaded_by, r.created_at, r.duplicate_of,
           (SELECT count(*)::int FROM receipt_items i WHERE i.receipt_id = r.id) AS item_count,
           ${
             terms.length
               ? sql`(SELECT array_agg(i.name ORDER BY i.position) FROM receipt_items i
                      WHERE i.receipt_id = r.id AND i.name ILIKE ANY(${terms}))`
               : sql`NULL::text[]`
           } AS matched_items,
           (SELECT json_agg(DISTINCT jsonb_build_object('name', root.name, 'icon', root.icon, 'color', root.color))
              FROM receipt_items i
              JOIN categories c ON c.id = i.category_id
              JOIN categories root ON root.id = COALESCE(c.parent_id, c.id)
             WHERE i.receipt_id = r.id) AS categories
    FROM receipts r
    WHERE ${where}
    ORDER BY ${EFFECTIVE_DATE} DESC, r.created_at DESC
    LIMIT ${f.limit ?? 30} OFFSET ${f.offset ?? 0}`;
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM receipts r WHERE ${where}`;
  return { rows, total: count };
}

export interface ReceiptDetail {
  id: string;
  status: string;
  source: string;
  uploaded_by: string | null;
  original_filename: string | null;
  mime_type: string;
  file_size: number;
  preview_path: string | null;
  merchant: string | null;
  merchant_address: string | null;
  purchase_date: string | null;
  purchase_time: string | null;
  total: string | null;
  currency: string;
  payment_method: string | null;
  raw_text: string | null;
  notes: string | null;
  needs_review: boolean;
  review_reason: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  error: string | null;
  attempts: number;
  duplicate_of: string | null;
  duplicate_checked: boolean;
  processed_at: Date | null;
  created_at: Date;
}

export interface ReceiptItemRow {
  id: number;
  position: number;
  name: string;
  quantity: string;
  unit_price: string | null;
  total_price: string;
  category_id: number | null;
  category_source: string | null;
  warranty_months: number | null;
  warranty_until: string | null;
  notes: string | null;
}

/** Kurzinfo zum Original eines Duplikats (für Hinweis und Link). */
export async function receiptSummary(id: string) {
  const [r] = await sql<{ id: string; merchant: string | null; purchase_date: string | null; total: string | null; currency: string; source: string; created_at: Date }[]>`
    SELECT id, merchant, purchase_date::text, total::text, currency, source, created_at FROM receipts WHERE id = ${id}`;
  return r ?? null;
}

export async function getReceipt(id: string): Promise<{ receipt: ReceiptDetail; items: ReceiptItemRow[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [receipt] = await sql<ReceiptDetail[]>`
    SELECT id, status, source, uploaded_by, original_filename, mime_type, file_size, preview_path, merchant,
           merchant_address, purchase_date::text, to_char(purchase_time, 'HH24:MI') AS purchase_time, total::text,
           currency, payment_method, raw_text, notes, needs_review, review_reason, ai_provider, ai_model, error,
           attempts, duplicate_of, duplicate_checked, processed_at, created_at
    FROM receipts WHERE id = ${id}`;
  if (!receipt) return null;
  const items = await sql<ReceiptItemRow[]>`
    SELECT i.id, i.position, i.name, i.quantity::text, i.unit_price::text, i.total_price::text, i.category_id,
           i.category_source, i.warranty_months, i.notes,
           CASE WHEN i.warranty_months > 0 AND r.purchase_date IS NOT NULL
                THEN (r.purchase_date + make_interval(months => i.warranty_months))::date::text END AS warranty_until
    FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
    WHERE i.receipt_id = ${id}
    ORDER BY i.position, i.id`;
  return { receipt, items };
}

// ---------- Auswertungen ----------

export interface Range {
  from: string;
  to: string;
}

export async function kpis(range: Range) {
  const [row] = await sql<{ total: string | null; receipts: number; items: number; merchants: number }[]>`
    SELECT COALESCE(sum(i.total_price), 0)::text AS total,
           count(DISTINCT r.id)::int AS receipts,
           count(i.id)::int AS items,
           count(DISTINCT lower(r.merchant))::int AS merchants
    FROM receipts r JOIN receipt_items i ON i.receipt_id = r.id
    WHERE r.status = 'done' AND r.duplicate_of IS NULL AND ${EFFECTIVE_DATE} BETWEEN ${range.from}::date AND ${range.to}::date`;
  return {
    total: Number(row.total ?? 0),
    receipts: row.receipts,
    items: row.items,
    merchants: row.merchants,
  };
}

export interface CategorySum {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  children: { id: number; name: string; total: number }[];
}

export async function spendingByCategory(range: Range): Promise<CategorySum[]> {
  const rows = await sql<
    { root_id: number; root_name: string; icon: string | null; color: string | null; cat_id: number; cat_name: string; total: string }[]
  >`
    SELECT root.id AS root_id, root.name AS root_name, root.icon, root.color, c.id AS cat_id, c.name AS cat_name,
           sum(i.total_price)::text AS total
    FROM receipt_items i
    JOIN receipts r ON r.id = i.receipt_id
    JOIN categories c ON c.id = i.category_id
    JOIN categories root ON root.id = COALESCE(c.parent_id, c.id)
    WHERE r.status = 'done' AND r.duplicate_of IS NULL AND ${EFFECTIVE_DATE} BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY root.id, root.name, root.icon, root.color, c.id, c.name`;
  const map = new Map<number, CategorySum>();
  for (const r of rows) {
    const entry =
      map.get(r.root_id) ??
      ({ id: r.root_id, name: r.root_name, icon: r.icon, color: r.color, total: 0, children: [] } as CategorySum);
    const t = Number(r.total);
    entry.total += t;
    if (r.cat_id !== r.root_id) entry.children.push({ id: r.cat_id, name: r.cat_name, total: t });
    map.set(r.root_id, entry);
  }
  const list = [...map.values()].map((e) => ({
    ...e,
    total: Math.round(e.total * 100) / 100,
    children: e.children.sort((a, b) => b.total - a.total),
  }));
  return list.sort((a, b) => b.total - a.total);
}

export interface MonthlyRow {
  month: string;
  total: number;
  byCategory: Record<string, number>;
}

export async function monthlyTrend(months = 12): Promise<MonthlyRow[]> {
  const rows = await sql<{ month: string; root_name: string; total: string }[]>`
    WITH m AS (
      SELECT to_char(d, 'YYYY-MM') AS month
      FROM generate_series(date_trunc('month', now()) - make_interval(months => ${months - 1}),
                           date_trunc('month', now()), interval '1 month') d
    )
    SELECT m.month, COALESCE(root.name, '') AS root_name, COALESCE(sum(i.total_price), 0)::text AS total
    FROM m
    LEFT JOIN receipts r ON r.status = 'done' AND r.duplicate_of IS NULL AND to_char(${EFFECTIVE_DATE}, 'YYYY-MM') = m.month
    LEFT JOIN receipt_items i ON i.receipt_id = r.id
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN categories root ON root.id = COALESCE(c.parent_id, c.id)
    GROUP BY m.month, root.name
    ORDER BY m.month`;
  const out = new Map<string, MonthlyRow>();
  for (const r of rows) {
    const e = out.get(r.month) ?? { month: r.month, total: 0, byCategory: {} };
    const t = Number(r.total);
    e.total = Math.round((e.total + t) * 100) / 100;
    if (r.root_name) e.byCategory[r.root_name] = Math.round(((e.byCategory[r.root_name] ?? 0) + t) * 100) / 100;
    out.set(r.month, e);
  }
  return [...out.values()];
}

export async function topMerchants(range: Range, limit = 10) {
  const rows = await sql<{ merchant: string; receipts: number; total: string }[]>`
    SELECT COALESCE(r.merchant, 'Unbekannt') AS merchant, count(*)::int AS receipts, sum(r.total)::text AS total
    FROM receipts r
    WHERE r.status = 'done' AND r.duplicate_of IS NULL AND r.total IS NOT NULL
      AND ${EFFECTIVE_DATE} BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY COALESCE(r.merchant, 'Unbekannt')
    ORDER BY sum(r.total) DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

export async function topItems(range: Range, limit = 10) {
  const rows = await sql<{ name: string; count: number; total: string }[]>`
    SELECT min(i.name) AS name, count(*)::int AS count, sum(i.total_price)::text AS total
    FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
    WHERE r.status = 'done' AND r.duplicate_of IS NULL AND i.total_price > 0
      AND ${EFFECTIVE_DATE} BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY lower(i.name)
    ORDER BY sum(i.total_price) DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

export async function spendingByWeekday(range: Range) {
  const rows = await sql<{ dow: number; total: string; receipts: number }[]>`
    SELECT extract(isodow FROM ${EFFECTIVE_DATE})::int AS dow, sum(r.total)::text AS total, count(*)::int AS receipts
    FROM receipts r
    WHERE r.status = 'done' AND r.duplicate_of IS NULL AND r.total IS NOT NULL
      AND ${EFFECTIVE_DATE} BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY 1 ORDER BY 1`;
  const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  return names.map((name, i) => {
    const r = rows.find((x) => x.dow === i + 1);
    return { name, total: r ? Number(r.total) : 0, receipts: r?.receipts ?? 0 };
  });
}

export async function queueStatus() {
  const rows = await sql<{ status: string; count: number }[]>`
    SELECT status, count(*)::int AS count FROM receipts GROUP BY status`;
  const s = Object.fromEntries(rows.map((r) => [r.status, r.count])) as Record<string, number>;
  const [{ review, duplicates }] = await sql<{ review: number; duplicates: number }[]>`
    SELECT count(*) FILTER (WHERE needs_review AND duplicate_of IS NULL)::int AS review,
           count(*) FILTER (WHERE duplicate_of IS NOT NULL)::int AS duplicates
    FROM receipts WHERE status = 'done'`;
  return {
    pending: s.pending ?? 0,
    processing: s.processing ?? 0,
    done: s.done ?? 0,
    failed: s.failed ?? 0,
    review,
    duplicates,
  };
}

// ---------- Garantie ----------

export interface WarrantyRow {
  item_id: number;
  receipt_id: string;
  name: string;
  total_price: string;
  warranty_months: number;
  merchant: string | null;
  purchase_date: string;
  warranty_until: string;
  days_left: number;
}

export async function warranties(filter: "active" | "expiring" | "expired" | "all", days = 90): Promise<WarrantyRow[]> {
  const cond =
    filter === "active"
      ? sql`w.warranty_until >= current_date`
      : filter === "expiring"
        ? sql`w.warranty_until BETWEEN current_date AND current_date + ${days}::int`
        : filter === "expired"
          ? sql`w.warranty_until < current_date`
          : sql`TRUE`;
  return sql<WarrantyRow[]>`
    SELECT w.item_id, w.receipt_id, w.name, w.total_price::text, w.warranty_months, w.merchant,
           w.purchase_date::text, w.warranty_until::text, (w.warranty_until - current_date)::int AS days_left
    FROM warranty_items w
    WHERE ${cond}
    ORDER BY ${filter === "expired" ? sql`w.warranty_until DESC` : sql`w.warranty_until ASC`}`;
}

// ---------- Export ----------

export async function exportRows(range: Range) {
  return sql<
    {
      date: string;
      time: string | null;
      merchant: string | null;
      item: string;
      quantity: string;
      unit_price: string | null;
      price: string;
      category: string | null;
      subcategory: string | null;
      receipt_total: string | null;
      payment_method: string | null;
      warranty_until: string | null;
      receipt_id: string;
    }[]
  >`
    SELECT ${EFFECTIVE_DATE}::text AS date, to_char(r.purchase_time, 'HH24:MI') AS time, r.merchant,
           i.name AS item, i.quantity::text, i.unit_price::text, i.total_price::text AS price,
           root.name AS category, CASE WHEN c.parent_id IS NOT NULL THEN c.name END AS subcategory,
           r.total::text AS receipt_total, r.payment_method,
           CASE WHEN i.warranty_months > 0 AND r.purchase_date IS NOT NULL
                THEN (r.purchase_date + make_interval(months => i.warranty_months))::date::text END AS warranty_until,
           r.id AS receipt_id
    FROM receipt_items i
    JOIN receipts r ON r.id = i.receipt_id
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN categories root ON root.id = COALESCE(c.parent_id, c.id)
    WHERE r.status = 'done' AND r.duplicate_of IS NULL AND ${EFFECTIVE_DATE} BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY 1, r.id, i.position`;
}
