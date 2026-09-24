import { exportRows } from "@/lib/queries";
import { todayIso } from "@/lib/format";

function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Deutsche Excel-Konvention: Semikolon als Trenner, Komma als Dezimalzeichen
function num(v: string | null): string {
  return v === null ? "" : v.replace(".", ",");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "2000-01-01";
  const to = url.searchParams.get("to") || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return new Response("Ungültiger Zeitraum", { status: 400 });
  }
  const rows = await exportRows({ from, to });
  const header = [
    "Datum", "Uhrzeit", "Geschäft", "Artikel", "Menge", "Einzelpreis", "Preis", "Kategorie", "Unterkategorie",
    "Belegsumme", "Zahlungsart", "Garantie bis", "Beleg-ID",
  ];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.date, r.time, r.merchant, r.item, num(r.quantity), num(r.unit_price), num(r.price), r.category,
        r.subcategory, num(r.receipt_total), r.payment_method, r.warranty_until, r.receipt_id,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  // BOM, damit Excel Umlaute korrekt anzeigt
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kassenbelege_${from}_${to}.csv"`,
    },
  });
}
