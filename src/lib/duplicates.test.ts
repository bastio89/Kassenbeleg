import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

// Integrationstest gegen eine echte PostgreSQL-Datenbank (DATABASE_URL).
// Ohne erreichbare Datenbank wird er übersprungen.
const url = process.env.DATABASE_URL;
const db = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const available = db ? await db`SELECT 1`.then(() => true, () => false) : false;

describe.skipIf(!available)("findContentDuplicate", async () => {
  const { checkDuplicate, markNotDuplicate } = await import("./duplicates");
  const { sql } = await import("./db");
  const created: string[] = [];
  let n = 0;

  async function receipt(merchant: string | null, date: string, total: number, time: string | null, items = 2) {
    // created_at aufsteigend, damit "älterer Beleg" eindeutig ist
    n++;
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO receipts (status, file_path, mime_type, file_size, sha256, merchant, purchase_date, purchase_time,
                            total, notes, created_at)
      VALUES ('done', 'test.jpg', 'image/jpeg', 1, ${"test-" + Math.random()}, ${merchant}, ${date}, ${time},
              ${total}, 'DUPLIKAT-TEST', now() + make_interval(secs => ${n}))
      RETURNING id`;
    for (let i = 0; i < items; i++) {
      await sql`INSERT INTO receipt_items (receipt_id, position, name, total_price) VALUES (${r.id}, ${i}, 'x', 1)`;
    }
    created.push(r.id);
    return r.id;
  }

  beforeAll(async () => {
    await sql`DELETE FROM receipts WHERE notes = 'DUPLIKAT-TEST'`;
  });
  afterAll(async () => {
    await sql`DELETE FROM receipts WHERE id = ANY(${created})`;
    await db?.end();
  });

  it("erkennt denselben Bon (gleiches Geschäft, Datum, Summe, Uhrzeit)", async () => {
    const a = await receipt("REWE Markt", "2001-01-02", 21.18, "17:42");
    const b = await receipt("REWE", "2001-01-02", 21.18, "17:43");
    expect(await checkDuplicate(b)).toBe(a);
  });

  it("gleiche Summe am selben Tag, aber andere Uhrzeit → kein Duplikat", async () => {
    await receipt("Bäckerei Müller", "2001-01-03", 3.4, "07:10");
    const b = await receipt("Bäckerei Müller", "2001-01-03", 3.4, "16:30");
    expect(await checkDuplicate(b)).toBeNull();
  });

  it("anderes Geschäft → kein Duplikat", async () => {
    await receipt("Lidl", "2001-01-04", 12.5, "10:00");
    const b = await receipt("Aldi Süd", "2001-01-04", 12.5, "10:00");
    expect(await checkDuplicate(b)).toBeNull();
  });

  it("ohne Uhrzeit entscheidet die Artikelanzahl", async () => {
    const a = await receipt("dm-drogerie markt", "2001-01-05", 9.95, null, 3);
    const same = await receipt("dm", "2001-01-05", 9.95, null, 3);
    const other = await receipt("dm", "2001-01-05", 9.95, null, 1);
    expect(await checkDuplicate(same)).toBe(a);
    expect(await checkDuplicate(other)).toBeNull();
  });

  it("bestätigtes 'Kein Duplikat' wird nicht erneut markiert", async () => {
    await receipt("Tankstelle", "2001-01-06", 50, "08:00");
    const b = await receipt("Tankstelle", "2001-01-06", 50, "08:01");
    expect(await checkDuplicate(b)).not.toBeNull();
    await markNotDuplicate(b);
    expect(await checkDuplicate(b)).toBeNull();
    const [row] = await sql<{ duplicate_of: string | null }[]>`SELECT duplicate_of FROM receipts WHERE id = ${b}`;
    expect(row.duplicate_of).toBeNull();
  });

  it("Duplikate zählen nicht in der Auswertung", async () => {
    const { kpis } = await import("./queries");
    const k = await kpis({ from: "2001-01-02", to: "2001-01-02" });
    expect(k.receipts).toBe(1);
  });
});
