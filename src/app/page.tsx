import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CategoryBars } from "@/components/CategoryBars";
import { ReceiptRow } from "@/components/ReceiptRow";
import { UploadBox } from "@/components/UploadBox";
import { dateDe, eur, monthName, monthRange, shiftMonth, todayIso } from "@/lib/format";
import { kpis, listReceipts, queueStatus, spendingByCategory, warranties } from "@/lib/queries";

export default async function Home() {
  const month = todayIso().slice(0, 7);
  const range = monthRange(month);
  const prevRange = monthRange(shiftMonth(month, -1));
  const [current, previous, cats, recent, status, expiring] = await Promise.all([
    kpis(range),
    kpis(prevRange),
    spendingByCategory(range),
    listReceipts({ limit: 6 }),
    queueStatus(),
    warranties("expiring", 60),
  ]);
  const busy = status.pending + status.processing > 0;
  const diff = previous.total ? ((current.total - previous.total) / previous.total) * 100 : null;

  return (
    <div className="stack">
      <AutoRefresh active={busy} />
      <UploadBox />

      {busy && (
        <div className="alert" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          ⚙️ {status.pending + status.processing} Beleg(e) werden gerade ausgewertet …
        </div>
      )}
      {(status.failed > 0 || status.review > 0 || status.duplicates > 0) && (
        <Link href="/belege?pruefen=1" className="alert" style={{ display: "block" }}>
          ⚠️{" "}
          {[
            status.failed > 0 && `${status.failed} fehlgeschlagen`,
            status.review > 0 && `${status.review} zum Prüfen`,
            status.duplicates > 0 && `${status.duplicates} mögliche${status.duplicates === 1 ? "s" : ""} Duplikat${status.duplicates === 1 ? "" : "e"}`,
          ]
            .filter(Boolean)
            .join(" · ")}{" "}
          – ansehen →
        </Link>
      )}

      <div className="grid grid-kpi">
        <div className="card kpi">
          <div className="label">Ausgaben {monthName(month)}</div>
          <div className="value">{eur(current.total)}</div>
          <div className="sub">
            {diff === null
              ? "–"
              : `${diff > 0 ? "+" : ""}${diff.toFixed(0)} % ggü. Vormonat (${eur(previous.total)})`}
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Belege</div>
          <div className="value">{current.receipts}</div>
          <div className="sub">{current.items} Artikel</div>
        </div>
        <div className="card kpi">
          <div className="label">Ø pro Einkauf</div>
          <div className="value">{current.receipts ? eur(current.total / current.receipts) : "–"}</div>
          <div className="sub">{current.merchants} Geschäfte</div>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Wofür diesen Monat?</h2>
            <Link href="/auswertung" className="small">
              Auswertung →
            </Link>
          </div>
          <CategoryBars data={cats} limit={7} linkRange={range} />
        </section>

        <section className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>🛡️ Garantie läuft bald ab</h2>
            <Link href="/garantie" className="small">
              Alle →
            </Link>
          </div>
          {expiring.length === 0 ? (
            <p className="muted">In den nächsten 60 Tagen läuft keine Garantie ab.</p>
          ) : (
            <table>
              <tbody>
                {expiring.slice(0, 6).map((w) => (
                  <tr key={w.item_id}>
                    <td>
                      <Link href={`/belege/${w.receipt_id}`}>{w.name}</Link>
                      <div className="muted small">{w.merchant}</div>
                    </td>
                    <td className="right small">
                      bis {dateDe(w.warranty_until)}
                      <div className="muted">noch {w.days_left} Tage</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Zuletzt erfasst</h2>
          <Link href="/belege" className="small">
            Alle Belege →
          </Link>
        </div>
        {recent.rows.length === 0 ? (
          <div className="card empty">Noch keine Belege. Mach ein Foto von deinem ersten Kassenbon! 📷</div>
        ) : (
          <div className="receipt-list">
            {recent.rows.map((r) => (
              <ReceiptRow key={r.id} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
