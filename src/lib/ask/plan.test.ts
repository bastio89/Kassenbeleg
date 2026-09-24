import { describe, expect, it } from "vitest";
import { normalizePlan, resolvePeriod, type AskPlan } from "./plan";

const cats = new Set(["Lebensmittel", "Restaurant & Café", "Lebensmittel > Getränke"]);
const plan = (p: Partial<AskPlan>) => normalizePlan({ intent: "sum", period: "all", ...p }, cats);
const TODAY = "2026-09-24"; // Donnerstag

describe("resolvePeriod", () => {
  it.each([
    ["this_year", "2026-01-01", "2026-09-24"],
    ["last_year", "2025-01-01", "2025-12-31"],
    ["this_month", "2026-09-01", "2026-09-24"],
    ["last_month", "2026-08-01", "2026-08-31"],
    ["this_week", "2026-09-21", "2026-09-24"],
    ["last_week", "2026-09-14", "2026-09-20"],
    ["yesterday", "2026-09-23", "2026-09-23"],
    ["last_30_days", "2026-08-26", "2026-09-24"],
    ["last_12_months", "2025-10-01", "2026-09-24"],
  ] as const)("%s", (period, from, to) => {
    expect(resolvePeriod(plan({ period }), TODAY)).toMatchObject({ from, to });
  });

  it("Monat ohne Jahr: der zuletzt vergangene", () => {
    expect(resolvePeriod(plan({ period: "month", month: 8 }), TODAY)).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(resolvePeriod(plan({ period: "month", month: 12 }), TODAY)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod(plan({ period: "month", month: 9 }), TODAY)).toMatchObject({ from: "2026-09-01", to: "2026-09-24" });
  });

  it("Monat mit Jahr, Jahr und freier Zeitraum", () => {
    expect(resolvePeriod(plan({ period: "month", month: 3, year: 2025 }), TODAY)).toMatchObject({ from: "2025-03-01", to: "2025-03-31" });
    expect(resolvePeriod(plan({ period: "year", year: 2024 }), TODAY)).toMatchObject({ from: "2024-01-01", to: "2024-12-31" });
    expect(resolvePeriod(plan({ period: "custom", date_from: "2026-07-10", date_to: "2026-07-24" }), TODAY)).toMatchObject({
      from: "2026-07-10",
      to: "2026-07-24",
    });
  });

  it("unvollständige Angaben → insgesamt", () => {
    expect(resolvePeriod(plan({ period: "month" }), TODAY)).toMatchObject({ from: null, to: null, label: "insgesamt" });
  });
});

describe("normalizePlan", () => {
  it("verwirft ungültige Werte statt abzustürzen", () => {
    const p = normalizePlan(
      {
        intent: "delete_everything",
        group_by: "x",
        period: "someday",
        month: 13,
        search_terms: ["  Kaffee ", "kaffee", "x", 5],
        categories: ["Lebensmittel", "Erfunden"],
        merchant: "  REWE ",
        limit: 1000,
      },
      cats,
    );
    expect(p).toMatchObject({
      intent: "sum",
      group_by: "none",
      period: "all",
      month: null,
      search_terms: ["kaffee"],
      categories: ["Lebensmittel"],
      merchant: "rewe",
      limit: 50,
    });
  });

  it("kommt mit leerer Antwort klar", () => {
    expect(normalizePlan(null, cats)).toMatchObject({ intent: "sum", period: "all", search_terms: [], limit: 10 });
  });
});

import { refinePlan } from "./plan";

describe("refinePlan", () => {
  const base = (p: Partial<AskPlan> = {}) => plan(p);

  it("Zeitangaben aus der Frage überstimmen das Modell", () => {
    expect(refinePlan(base({ period: "custom" }), "Wie viel haben wir heute ausgegeben?").period).toBe("today");
    expect(refinePlan(base({ period: "last_12_months" }), "Wie viele Einkäufe hatten wir gestern?").period).toBe("yesterday");
    expect(refinePlan(base(), "Was haben wir im März 2025 bei dm gekauft?")).toMatchObject({ period: "month", month: 3, year: 2025 });
    expect(refinePlan(base(), "Ausgaben 2024")).toMatchObject({ period: "year", year: 2024 });
    expect(refinePlan(base(), "Was haben wir letztes Jahr bei IKEA gekauft?").period).toBe("last_year");
  });

  it("'im Monat' bedeutet Durchschnitt, nicht letzter Monat", () => {
    const p = refinePlan(base({ period: "last_month", search_terms: ["bier"] }), "Was kostet uns Bier im Monat?");
    expect(p).toMatchObject({ intent: "average_month", period: "last_12_months" });
  });

  it("entfernt Zeitwörter und den Geschäftsnamen aus den Suchbegriffen", () => {
    const p = refinePlan(base({ search_terms: ["gestern", "lidl"], merchant: "lidl" }), "Wie oft bei Lidl gestern?");
    expect(p.search_terms).toEqual([]);
  });

  it("Kategorie-Frage: Suchbegriff ist der Kategoriename", () => {
    const p = refinePlan(base({ search_terms: ["elektronik", "computer"], categories: ["Lebensmittel"] }), "x");
    expect(p.categories).toEqual([]); // "elektronik" steckt nicht in "Lebensmittel" → Produktfrage
    const q = refinePlan(base({ search_terms: ["restaurants"], categories: ["Restaurant & Café"] }), "x");
    expect(q).toMatchObject({ search_terms: [], categories: ["Restaurant & Café"] });
  });

  it("Produkt-Frage: geratene Kategorie wird verworfen", () => {
    const p = refinePlan(base({ search_terms: ["bier"], categories: ["Lebensmittel > Getränke"] }), "Bier?");
    expect(p).toMatchObject({ search_terms: ["bier"], categories: [] });
  });
});
