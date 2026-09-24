import { describe, expect, it } from "vitest";
import { looksLikeQuestion } from "./telegram";

describe("looksLikeQuestion", () => {
  it.each([
    ["Wie viel haben wir für Kaffee ausgegeben?", true],
    ["was haben wir bei ikea gekauft", true],
    ["Wann haben wir den Fernseher gekauft", true],
    ["Zeig mir alle Belege von dm", true],
    ["Ausgaben für Drogerie nach Monaten dieses Jahr", true],
    ["Waschmaschine", false],
    ["MediaMarkt Fernseher", false],
    ["Seriennummer 12345", false],
  ])("%s → %s", (text, expected) => {
    expect(looksLikeQuestion(text)).toBe(expected);
  });
});
