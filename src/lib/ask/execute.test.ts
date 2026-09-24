import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

// Integrationstest gegen PostgreSQL (DATABASE_URL); ohne Datenbank übersprungen.
const url = process.env.DATABASE_URL;
const probe = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const available = probe ? await probe`SELECT 1`.then(() => true, () => false) : false;
await probe?.end();

describe.skipIf(!available)("executePlan", async () => {
  const { sql } = await import("../db");
  const { executePlan } = await import("./execute");
  const { normalizePlan, resolvePeriod } = await import("./plan");
  const { buildAnswer } = await import("./index");

  const ids: string[] = [];
  const cat = async (path: string) => {
    const [root, sub] = path.split(" > ");
    const [r] = await sql<{ id: number }[]>`
      SELECT c.id FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      WHERE ${sub ? sql`c.name = ${sub} AND p.name = ${root}` : sql`c.name = ${root} AND c.parent_id IS NULL`}`;
    return r.id;
  };

  async function receipt(merchant: string, date: string, items: [string, number, string][], duplicateOf?: string) {
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO receipts (status, file_path, mime_type, file_size, sha256, merchant, purchase_date, total, notes, duplicate_of)
      VALUES ('done', 'x.jpg', 'image/jpeg', 1, ${"ask-" + Math.random()}, ${merchant}, ${date},
              ${items.reduce((s, i) => s + i[1], 0)}, 'ASK-TEST', ${duplicateOf ?? null})
      RETURNING id`;
    for (const [pos, [name, price, category]] of items.entries()) {
      await sql`INSERT INTO receipt_items (receipt_id, position, name, total_price, category_id)
                VALUES (${r.id}, ${pos}, ${name}, ${price}, ${await cat(category)})`;
    }
    ids.push(r.id);
    return r.id;
  }

  const run = (p: Record<string, unknown>) => {
    const plan = normalizePlan({ intent: "sum", period: "custom", date_from: "1999-01-01", date_to: "1999-12-31", ...p }, new Set(["Lebensmittel", "Elektronik"]));
    const range = resolvePeriod(plan, "2026-09-24");
    return { plan, range };
  };

  beforeAll(async () => {
    await sql`DELETE FROM receipts WHERE notes = 'ASK-TEST'`;
    const a = await receipt("REWE Markt", "1999-03-05", [
      ["JACOBS KAFFEE 500G", 6.99, "Lebensmittel > Getränke"],
      ["BIER PILS", 0.99, "Lebensmittel > Alkohol"],
      ["BANANE", 1.79, "Lebensmittel > Obst & Gemüse"],
    ]);
    await receipt("Rewe City", "1999-04-10", [["ESPRESSO BOHNEN", 12.49, "Lebensmittel > Getränke"]]);
    await receipt("MediaMarkt", "1999-04-20", [["Samsung Fernseher 55 Zoll", 599, "Elektronik > TV & Audio"]]);
    // Duplikat des ersten Bons – darf nirgends mitzählen
    await receipt("REWE Markt", "1999-03-05", [["JACOBS KAFFEE 500G", 6.99, "Lebensmittel > Getränke"]], a);
  });
  afterAll(async () => {
    await sql`DELETE FROM receipts WHERE id = ANY(${ids})`;
  });

  it("Summe über Suchbegriffe mit Varianten, ohne Duplikate", async () => {
    const { plan, range } = run({ search_terms: ["kaffee", "espresso"] });
    const r = await executePlan(plan, range, []);
    expect(r.total).toBeCloseTo(19.48);
    expect(r.items).toBe(2);
  });

  it("Kategorie schließt Unterkategorien ein", async () => {
    const { plan, range } = run({ categories: ["Lebensmittel"] });
    const r = await executePlan(plan, range, [await cat("Lebensmittel")]);
    expect(r.total).toBeCloseTo(6.99 + 0.99 + 1.79 + 12.49);
  });

  it("Geschäft: 'rewe' findet 'REWE Markt' und 'Rewe City'", async () => {
    const { plan, range } = run({ intent: "count", merchant: "rewe" });
    const r = await executePlan(plan, range, []);
    expect(r.receipts).toBe(2);
  });

  it("Aufteilung nach Monat und Durchschnitt", async () => {
    const { plan, range } = run({ intent: "average_month", group_by: "month" });
    const r = await executePlan(plan, range, []);
    expect(r.groups.map((g) => g.label)).toEqual(["1999-03", "1999-04"]);
    expect(r.months).toBe(12); // gewählter Zeitraum: ganzes Jahr 1999
  });

  it("Artikelliste: wann wurde der Fernseher gekauft", async () => {
    const { plan, range } = run({ intent: "list_items", search_terms: ["fernseher"] });
    const r = await executePlan(plan, range, []);
    expect(r.itemList).toHaveLength(1);
    expect(r.itemList[0]).toMatchObject({ date: "1999-04-20", merchant: "MediaMarkt", price: 599 });
    const answer = buildAnswer(plan, range, r);
    expect(answer.lines[0].text).toContain("20.04.1999");
    expect(answer.lines[0].receiptId).toBeTruthy();
  });

  it("keine Treffer → verständliche Antwort", async () => {
    const { plan, range } = run({ search_terms: ["hummer"] });
    const answer = buildAnswer(plan, range, await executePlan(plan, range, []));
    expect(answer.headline).toMatch(/keine passenden Einkäufe/);
  });

  it("Sonderzeichen in Suchbegriffen sind keine Platzhalter", async () => {
    const { plan, range } = run({ search_terms: ["50%", "k_ffee"] }); // % und _ wären sonst SQL-Platzhalter
    const r = await executePlan(plan, range, []);
    expect(r.items).toBe(0);
  });
});
