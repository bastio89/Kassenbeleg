import { sql } from "./db";

/**
 * Sucht einen älteren Beleg mit gleichem Inhalt – typischerweise derselbe Kassenbon,
 * zweimal fotografiert oder einmal per Telegram und einmal per Web-App erfasst.
 *
 * Kriterien:
 * - gleiches Kaufdatum und gleicher Gesamtbetrag
 * - ähnlicher Geschäftsname (gleich, einer ist Anfang des anderen oder Trigramm-Ähnlichkeit ≥ 0,5)
 * - Uhrzeit: sind beide bekannt, höchstens 2 Minuten Abstand; sonst gleiche Artikelanzahl
 */
export async function findContentDuplicate(receiptId: string): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    WITH c AS (
      SELECT id, created_at, status, duplicate_of, purchase_date, purchase_time, total, merchant,
             -- Geschäftsname ohne Leer- und Sonderzeichen: "REWE Markt" → "rewemarkt"
             regexp_replace(lower(coalesce(merchant, '')), '[^a-z0-9äöüß]', '', 'g') AS m
      FROM receipts
    )
    SELECT o.id
    FROM c n
    JOIN c o
      ON o.id <> n.id
     AND o.created_at < n.created_at
     AND o.status = 'done'
     AND o.duplicate_of IS NULL
     AND o.purchase_date = n.purchase_date
     AND o.total = n.total
    WHERE n.id = ${receiptId}
      AND n.purchase_date IS NOT NULL
      AND n.total IS NOT NULL
      AND (
        o.merchant IS NULL OR n.merchant IS NULL
        OR o.m = n.m
        OR (n.m <> '' AND starts_with(o.m, n.m))
        OR (o.m <> '' AND starts_with(n.m, o.m))
        OR similarity(lower(o.merchant), lower(n.merchant)) >= 0.5
      )
      AND CASE
        WHEN o.purchase_time IS NOT NULL AND n.purchase_time IS NOT NULL
          THEN abs(extract(epoch FROM o.purchase_time - n.purchase_time)) <= 120
        ELSE (SELECT count(*) FROM receipt_items WHERE receipt_id = o.id)
           = (SELECT count(*) FROM receipt_items WHERE receipt_id = n.id)
      END
    ORDER BY o.created_at
    LIMIT 1`;
  return row?.id ?? null;
}

/** Prüft einen frisch ausgewerteten Beleg und markiert ihn ggf. als Duplikat. */
export async function checkDuplicate(receiptId: string): Promise<string | null> {
  const [r] = await sql<{ duplicate_checked: boolean }[]>`
    SELECT duplicate_checked FROM receipts WHERE id = ${receiptId}`;
  if (!r || r.duplicate_checked) return null;
  const original = await findContentDuplicate(receiptId);
  await sql`UPDATE receipts SET duplicate_of = ${original}, updated_at = now() WHERE id = ${receiptId}`;
  return original;
}

/** Nutzer bestätigt: kein Duplikat – Beleg zählt wieder normal und wird nicht erneut markiert. */
export async function markNotDuplicate(receiptId: string): Promise<void> {
  await sql`
    UPDATE receipts SET duplicate_of = NULL, duplicate_checked = true, updated_at = now()
    WHERE id = ${receiptId}`;
}
