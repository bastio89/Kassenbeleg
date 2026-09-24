"use server";

// Hinweis: Die App läuft ohne Login im Heimnetz/Tailscale. Der Zugriffsschutz erfolgt über das Netzwerk
// (bzw. optional per BASIC_AUTH in proxy.ts), deshalb gibt es hier keine Benutzerprüfung.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { normalizeItemName, parseDate, parseNumber, parseTime } from "@/lib/parse";
import { deleteReceipt } from "@/lib/processing";
import { requeueReceipt } from "@/lib/receipts";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function uuid(fd: FormData, key = "id"): string {
  const v = str(fd, key);
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error("Ungültige ID");
  return v;
}

function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function refresh(receiptId?: string) {
  if (receiptId) revalidatePath(`/belege/${receiptId}`);
  revalidatePath("/", "layout");
}

// ---------- Belege ----------

export async function updateReceiptAction(fd: FormData) {
  const id = uuid(fd);
  const total = parseNumber(str(fd, "total"));
  await sql`
    UPDATE receipts SET
      merchant = ${str(fd, "merchant")},
      merchant_address = ${str(fd, "merchant_address")},
      purchase_date = ${parseDate(str(fd, "purchase_date"))},
      purchase_time = ${parseTime(str(fd, "purchase_time"))},
      total = ${total},
      payment_method = ${str(fd, "payment_method")},
      notes = ${str(fd, "notes")},
      needs_review = false,
      review_reason = NULL,
      updated_at = now()
    WHERE id = ${id}`;
  refresh(id);
}

export async function markReviewedAction(fd: FormData) {
  const id = uuid(fd);
  await sql`UPDATE receipts SET needs_review = false, review_reason = NULL, updated_at = now() WHERE id = ${id}`;
  refresh(id);
}

export async function reprocessAction(fd: FormData) {
  const id = uuid(fd);
  await requeueReceipt(id);
  refresh(id);
}

export async function deleteReceiptAction(fd: FormData) {
  const id = uuid(fd);
  await deleteReceipt(id);
  refresh();
  redirect("/belege");
}

// ---------- Positionen ----------

async function learnRule(name: string, categoryId: number) {
  const pattern = normalizeItemName(name);
  if (pattern.length < 3) return;
  await sql`
    INSERT INTO category_rules (pattern, category_id) VALUES (${pattern}, ${categoryId})
    ON CONFLICT (pattern) DO UPDATE SET category_id = EXCLUDED.category_id`;
}

/** Kategorie ändern – das System merkt sich die Zuordnung für künftige Belege. */
export async function setItemCategoryAction(itemId: number, categoryId: number) {
  const [item] = await sql<{ receipt_id: string; name: string }[]>`
    UPDATE receipt_items SET category_id = ${categoryId}, category_source = 'manual' WHERE id = ${itemId}
    RETURNING receipt_id, name`;
  if (!item) return;
  // Garantie an neue Kategorie anpassen, wenn sie noch automatisch gesetzt war
  const [cat] = await sql<{ default_warranty_months: number }[]>`
    SELECT default_warranty_months FROM categories WHERE id = ${categoryId}`;
  if (cat && cat.default_warranty_months > 0) {
    await sql`UPDATE receipt_items SET warranty_months = COALESCE(warranty_months, ${cat.default_warranty_months})
              WHERE id = ${itemId} AND total_price > 0`;
  }
  await learnRule(item.name, categoryId);
  refresh(item.receipt_id);
}

export async function updateItemAction(fd: FormData) {
  const itemId = intOrNull(fd, "item_id");
  if (!itemId) throw new Error("Ungültige Position");
  const name = str(fd, "name") ?? "Artikel";
  const quantity = parseNumber(str(fd, "quantity")) ?? 1;
  const totalPrice = parseNumber(str(fd, "total_price")) ?? 0;
  const unitPrice = parseNumber(str(fd, "unit_price"));
  const warranty = intOrNull(fd, "warranty_months");
  const [item] = await sql<{ receipt_id: string }[]>`
    UPDATE receipt_items SET
      name = ${name}, quantity = ${quantity}, unit_price = ${unitPrice}, total_price = ${totalPrice},
      warranty_months = ${warranty && warranty > 0 ? warranty : null},
      warranty_notified_at = NULL,
      notes = ${str(fd, "notes")}
    WHERE id = ${itemId}
    RETURNING receipt_id`;
  if (item) refresh(item.receipt_id);
}

export async function addItemAction(fd: FormData) {
  const id = uuid(fd, "receipt_id");
  const categoryId = intOrNull(fd, "category_id");
  const [{ pos }] = await sql<{ pos: number }[]>`
    SELECT COALESCE(max(position), -1)::int + 1 AS pos FROM receipt_items WHERE receipt_id = ${id}`;
  const warranty = intOrNull(fd, "warranty_months");
  await sql`
    INSERT INTO receipt_items (receipt_id, position, name, quantity, total_price, category_id, category_source, warranty_months)
    VALUES (${id}, ${pos}, ${str(fd, "name") ?? "Artikel"}, ${parseNumber(str(fd, "quantity")) ?? 1},
            ${parseNumber(str(fd, "total_price")) ?? 0}, ${categoryId}, 'manual',
            ${warranty && warranty > 0 ? warranty : null})`;
  refresh(id);
}

export async function deleteItemAction(fd: FormData) {
  const itemId = intOrNull(fd, "item_id");
  if (!itemId) return;
  const [item] = await sql<{ receipt_id: string }[]>`DELETE FROM receipt_items WHERE id = ${itemId} RETURNING receipt_id`;
  if (item) refresh(item.receipt_id);
}

// ---------- Kategorien ----------

export async function createCategoryAction(fd: FormData) {
  const name = str(fd, "name");
  if (!name) return;
  const parentId = intOrNull(fd, "parent_id");
  const [parent] = parentId
    ? await sql<{ default_warranty_months: number }[]>`SELECT default_warranty_months FROM categories WHERE id = ${parentId}`
    : [];
  const warranty = intOrNull(fd, "default_warranty_months") ?? parent?.default_warranty_months ?? 0;
  await sql`
    INSERT INTO categories (name, parent_id, icon, color, default_warranty_months, sort_order)
    VALUES (${name}, ${parentId}, ${str(fd, "icon")}, ${str(fd, "color")}, ${warranty},
            (SELECT COALESCE(max(sort_order), 0) + 1 FROM categories WHERE parent_id IS NOT DISTINCT FROM ${parentId}))
    ON CONFLICT DO NOTHING`;
  refresh();
}

export async function updateCategoryAction(fd: FormData) {
  const id = intOrNull(fd, "id");
  const name = str(fd, "name");
  if (!id || !name) return;
  await sql`
    UPDATE categories SET name = ${name}, icon = ${str(fd, "icon")}, color = ${str(fd, "color")},
           default_warranty_months = ${intOrNull(fd, "default_warranty_months") ?? 0}
    WHERE id = ${id}`;
  refresh();
}

export async function deleteCategoryAction(fd: FormData) {
  const id = intOrNull(fd, "id");
  const target = intOrNull(fd, "move_to");
  if (!id) return;
  await sql.begin(async (tx) => {
    // Artikel der Kategorie (und ihrer Unterkategorien) in die Zielkategorie verschieben
    await tx`
      UPDATE receipt_items SET category_id = ${target}
      WHERE category_id IN (SELECT id FROM categories WHERE id = ${id} OR parent_id = ${id})`;
    await tx`
      UPDATE category_rules SET category_id = ${target}
      WHERE ${target}::int IS NOT NULL AND category_id IN (SELECT id FROM categories WHERE id = ${id} OR parent_id = ${id})`;
    await tx`DELETE FROM categories WHERE id = ${id}`;
  });
  refresh();
}

export async function deleteRuleAction(fd: FormData) {
  const id = intOrNull(fd, "id");
  if (id) await sql`DELETE FROM category_rules WHERE id = ${id}`;
  refresh();
}
