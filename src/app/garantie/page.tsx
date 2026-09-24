import Link from "next/link";
import { dateDe, eur } from "@/lib/format";
import { warranties } from "@/lib/queries";

type Tab = "bald" | "aktiv" | "abgelaufen";

export default async function WarrantyPage({ searchParams }: PageProps<"/garantie">) {
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) as Tab | undefined;
  const current: Tab = tab === "aktiv" || tab === "abgelaufen" ? tab : "bald";
  const [soon, active, expired] = await Promise.all([
    warranties("expiring", 90),
    warranties("active"),
    warranties("expired"),
  ]);
  const rows = current === "bald" ? soon : current === "aktiv" ? active : expired;
  const value = active.reduce((s, w) => s + Number(w.total_price), 0);

  return (
    <div className="stack">
      <h1>🛡️ Garantie & Gewährleistung</h1>
      <div className="grid grid-kpi">
        <div className="card kpi">
          <div className="label">Aktive Garantien</div>
          <div className="value">{active.length}</div>
          <div className="sub">Warenwert {eur(value)}</div>
        </div>
        <div className="card kpi">
          <div className="label">Läuft in 90 Tagen ab</div>
          <div className="value">{soon.length}</div>
          <div className="sub">jetzt noch reklamieren möglich</div>
        </div>
      </div>

      <div className="tabs">
        <Link href="/garantie?tab=bald" className={current === "bald" ? "active" : undefined}>
          Läuft bald ab ({soon.length})
        </Link>
        <Link href="/garantie?tab=aktiv" className={current === "aktiv" ? "active" : undefined}>
          Aktiv ({active.length})
        </Link>
        <Link href="/garantie?tab=abgelaufen" className={current === "abgelaufen" ? "active" : undefined}>
          Abgelaufen ({expired.length})
        </Link>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {rows.length === 0 ? (
          <div className="empty">Keine Einträge.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ paddingLeft: 16 }}>Artikel</th>
                <th>Gekauft</th>
                <th>Garantie bis</th>
                <th className="right" style={{ paddingRight: 16 }}>
                  Preis
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.item_id}>
                  <td style={{ paddingLeft: 16 }}>
                    <Link href={`/belege/${w.receipt_id}`}>{w.name}</Link>
                    <div className="small muted">{w.merchant ?? "Unbekannt"}</div>
                  </td>
                  <td className="small">{dateDe(w.purchase_date)}</td>
                  <td className="small">
                    {dateDe(w.warranty_until)}
                    <div className={w.days_left < 0 ? "muted" : w.days_left <= 30 ? "" : "muted"} style={w.days_left >= 0 && w.days_left <= 30 ? { color: "var(--bad)" } : undefined}>
                      {w.days_left >= 0 ? `noch ${w.days_left} Tage` : `seit ${-w.days_left} Tagen`}
                    </div>
                  </td>
                  <td className="right num" style={{ paddingRight: 16 }}>
                    {eur(w.total_price)}
                    <div>
                      <a className="small" href={`/api/files/${w.receipt_id}?download=1`}>
                        ⬇️ Beleg
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="small muted">
        Garantien werden automatisch für langlebige Artikel (Elektronik, Haushaltsgeräte, Werkzeug, Möbel …) mit der
        gesetzlichen Gewährleistung von 24 Monaten erfasst. Hat ein Produkt eine längere Herstellergarantie, trag die
        Monate beim Artikel ein. Die Standardwerte pro Kategorie stellst du unter{" "}
        <Link href="/kategorien">Kategorien</Link> ein.
      </p>
    </div>
  );
}
