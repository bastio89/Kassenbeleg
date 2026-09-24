import { describe, expect, it } from "vitest";
import {
  extractJson,
  findDateInText,
  findTotalInText,
  normalizeItemName,
  parseDate,
  parseNumber,
  parseItemsFromText,
  parseTime,
} from "./parse";

describe("parseNumber", () => {
  it("versteht deutsche und englische Formate", () => {
    expect(parseNumber("1,99")).toBe(1.99);
    expect(parseNumber("1.234,56 €")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("-0,25")).toBe(-0.25);
    expect(parseNumber("0,25-")).toBe(-0.25);
    expect(parseNumber(3.5)).toBe(3.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

describe("parseDate", () => {
  it("normalisiert gängige Formate", () => {
    expect(parseDate("2024-03-12")).toBe("2024-03-12");
    expect(parseDate("12.03.2024")).toBe("2024-03-12");
    expect(parseDate("12.03.24")).toBe("2024-03-12");
    expect(parseDate("31.02.2024")).toBeNull();
    expect(parseDate("01.01.2999")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseTime", () => {
  it("liest Uhrzeiten", () => {
    expect(parseTime("9:05")).toBe("09:05:00");
    expect(parseTime("25:00")).toBeNull();
  });
});

describe("Textsuche", () => {
  const bon = `REWE Markt GmbH
Musterstr. 1
BANANE           1,49 B
MILCH 1,5%       1,19 B
--------------------------
SUMME EUR        2,68
Geg. EC-Cash     2,68
Datum: 14.05.2025  Uhrzeit: 18:22`;

  it("findet Datum und Summe", () => {
    expect(findDateInText(bon)).toBe("2025-05-14");
    expect(findTotalInText(bon)).toBe(2.68);
  });

  it("ignoriert Zwischensumme und MwSt", () => {
    expect(findTotalInText("Zwischensumme 10,00\nMwSt 19% 1,60\nZU ZAHLEN 11,60")).toBe(11.6);
  });
});

describe("normalizeItemName", () => {
  it("entfernt Mengen und Sonderzeichen", () => {
    expect(normalizeItemName("MILCH 1,5% 1L")).toBe("milch");
    expect(normalizeItemName("Bananen 1,234 kg")).toBe("bananen");
  });
});

describe("extractJson", () => {
  it("findet JSON in Codeblöcken", () => {
    expect(extractJson('Hier:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('bla {"a":2} bla')).toEqual({ a: 2 });
  });
});

describe("parseItemsFromText", () => {
  it("liest Artikelzeilen bis zur Summe", () => {
    const text = `REWE Markt GmbH
Hauptstraße 12
UID Nr.: DE812706034
EUR
BANANE CHIQUITA 1,79 A
VOLLMILCH 3,5% IL 1,19 A
APFEL ROT 2,38 A
  2 Stk x 1,19
TOMATEN 1,65 A
  0,834 kg x 1,99 EUR/kg
LEERGUT -0,75 A
RABATT 0,50-
SUMME EUR 6,26
Geg. EC-Cash EUR 6,26
A= 7,0% 6,79 0,47 7,26`;
    const items = parseItemsFromText(text);
    expect(items.map((i) => i.name)).toEqual([
      "BANANE CHIQUITA",
      "VOLLMILCH 3,5% IL",
      "APFEL ROT",
      "TOMATEN",
      "LEERGUT",
      "RABATT",
    ]);
    expect(items[2]).toMatchObject({ quantity: 2, unitPrice: 1.19, totalPrice: 2.38 });
    expect(items[3]).toMatchObject({ quantity: 0.834, unitPrice: 1.99 });
    expect(items[4].totalPrice).toBe(-0.75);
    expect(items[5].totalPrice).toBe(-0.5);
  });

  it("erkennt Menge in derselben Zeile", () => {
    const [item] = parseItemsFromText("Bananen 2 x 1,19 2,38 A\nSumme 2,38");
    expect(item).toMatchObject({ name: "Bananen", quantity: 2, unitPrice: 1.19, totalPrice: 2.38 });
  });
});

import { cleanMerchant } from "./ai";

describe("cleanMerchant", () => {
  it("entfernt Rechtsformen", () => {
    expect(cleanMerchant("MediaMarkt E-Business GmbH")).toBe("MediaMarkt E-Business");
    expect(cleanMerchant("REWE Markt GmbH")).toBe("REWE Markt");
    expect(cleanMerchant("Müller GmbH & Co. KG")).toBe("Müller");
    expect(cleanMerchant("dm-drogerie markt")).toBe("dm-drogerie markt");
  });
});
