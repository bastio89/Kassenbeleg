// Entwicklungs-Hilfe: prüft, wie gut das konfigurierte Modell Artikel kategorisiert.
// Aufruf: OLLAMA_MODEL=qwen2.5:3b npx tsx src/scripts/eval-categories.ts
import { categorizeItems } from "../lib/ai";
import { buildLookup, getCategories } from "../lib/categories";
import { sql } from "../lib/db";

const cases: [string, string, string][] = [
  ["REWE", "BANANE CHIQUITA", "Obst & Gemüse"],
  ["REWE", "VOLLMILCH 3,5% 1L", "Milchprodukte & Eier"],
  ["REWE", "BUTTER DEUTSCHE MARKEN", "Milchprodukte & Eier"],
  ["REWE", "ROGGENBROT 750G", "Brot & Backwaren"],
  ["REWE", "NIVEA DUSCHGEL", "Körperpflege"],
  ["REWE", "BIER PILS 0,5L", "Alkohol"],
  ["REWE", "PFAND 0,25", "Pfand & Rabatte"],
  ["REWE", "LEERGUT", "Pfand & Rabatte"],
  ["REWE", "USB-C LADEKABEL 2M", "Kabel & Kleinteile"],
  ["REWE", "JA! SPAGHETTI 500G", "Grundnahrungsmittel"],
  ["REWE", "COCA COLA 1,5L", "Getränke"],
  ["REWE", "HARIBO GOLDBAEREN", "Süßwaren & Snacks"],
  ["REWE", "SPUELMITTEL PRIL", "Reinigungsmittel"],
  ["REWE", "HAEHNCHENBRUSTFILET", "Fleisch, Wurst & Fisch"],
  ["MediaMarkt", "BOSCH Waschmaschine WGG14400", "Haushaltsgeräte"],
  ["MediaMarkt", "Lieferung und Anschluss", "Gebühren & Service"],
  ["MediaMarkt", "Samsung Galaxy S25 128GB", "Smartphone & Tablet"],
  ["dm", "Balea Shampoo", "Körperpflege"],
  ["dm", "Pampers Gr. 4", "Babybedarf"],
  ["Aral", "Super E10", "Tanken & Laden"],
  ["OBI", "Makita Akkuschrauber DDF485", "Werkzeug & Maschinen"],
  ["Rossmann", "Toilettenpapier 8 Rollen", "Hygieneartikel"],
];

const lookup = buildLookup(await getCategories());
const t0 = Date.now();
const res = await categorizeItems(
  null,
  cases.map((c, i) => ({ index: i, name: `${c[1]} (Geschäft: ${c[0]})` })),
  lookup.paths,
);
let ok = 0;
for (const [i, c] of cases.entries()) {
  const got = res.find((r) => r.index === i);
  const hit = got?.category.endsWith(c[2]) ?? false;
  if (hit) ok++;
  console.log(`${hit ? "✓" : "✗"} ${c[1].padEnd(32)} → ${got?.category ?? "-"}`);
}
console.log(`\n${process.env.OLLAMA_MODEL}: ${ok}/${cases.length} richtig in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await sql.end();
