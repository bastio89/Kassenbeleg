import { describe, expect, it } from "vitest";
import { reconcile } from "./processing";

const base = {
  merchant: "REWE",
  merchantAddress: null,
  date: null,
  time: null,
  total: 5,
  currency: "EUR",
  paymentMethod: null,
  items: [{ name: "BANANE", quantity: 1, unitPrice: null, totalPrice: 1.79 }],
};

const text = `REWE
BANANE 1,79 A
MILCH 1,19 A
BROT 2,49 A
SUMME EUR 5,47
14.08.2025 17:42`;

describe("reconcile", () => {
  it("ergänzt Datum/Uhrzeit aus dem Text und übernimmt vollständige OCR-Zeilen", () => {
    const { extraction, review } = reconcile({ ...base, total: 5.47 }, text);
    expect(extraction.date).toBe("2025-08-14");
    expect(extraction.time).toBe("17:42:00");
    expect(extraction.items).toHaveLength(3);
    expect(review).toEqual([]);
  });

  it("korrigiert eine falsch gelesene KI-Summe", () => {
    const { extraction } = reconcile({ ...base, total: 5 }, text);
    expect(extraction.total).toBe(5.47);
    expect(extraction.items).toHaveLength(3);
  });

  it("legt eine Sammelposition an, wenn keine Artikel erkannt wurden", () => {
    const { extraction, review } = reconcile({ ...base, items: [], total: 12.5 }, "Tankstelle\nBetrag 12,50");
    expect(extraction.items).toEqual([{ name: "Einkauf REWE", quantity: 1, unitPrice: null, totalPrice: 12.5 }]);
    expect(review).toContain("Keine Einzelpositionen erkannt");
  });
});
