import Link from "next/link";
import { AskBox } from "@/components/AskBox";
import { CategoryBars } from "@/components/CategoryBars";
import { MonthlyChart, SimpleBarChart } from "@/components/Charts";
import { dateDe, eur, monthName, monthRange, shiftMonth, todayIso } from "@/lib/format";
import { kpis, monthlyTrend, spendingByCategory, spendingByWeekday, topItems, topMerchants } from "@/lib/queries";

type Period = "monat" | "jahr" | "12m" | "frei";

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AnalysisPage({ searchParams }: PageProps<"/auswertung">) {
  const sp = await searchParams;
  const today = todayIso();
  const period = (first(sp.zeitraum) as Period) || "monat";
  const month = /^\d{4}-\d{2}$/.test(first(sp.monat) ?? "") ? first(sp.monat)! : today.slice(0, 7);
  const year = /^\d{4}$/.test(first(sp.jahr) ?? "") ? first(sp.jahr)! : today.slice(0, 4);

  let range: { from: string; to: string };
  let title: string;
  let prev: string | null = null;
  let next: string | null = null;
  if (period === "jahr") {
    range = { from: `${year}-01-01`, to: `${year}-12-31` };
    title = `Jahr ${year}`;
    prev = `/auswertung?zeitraum=jahr&jahr=${+year - 1}`;
    if (+year < +today.slice(0, 4)) next = `/auswertung?zeitraum=jahr&jahr=${+year + 1}`;
  } else if (period === "12m") {
    range = { from: `${shiftMonth(today.slice(0, 7), -11)}-01`, to: today };
    title = "Letzte 12 Monate";
  } else if (period === "frei") {
    const from = first(sp.von) ?? "";
    const to = first(sp.bis) ?? "";
    range = {
      from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : `${today.slice(0, 7)}-01`,
      to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today,
    };
    title = `${dateDe(range.from)} – ${dateDe(range.to)}`;
  } else {
    range = monthRange(month);
    title = monthName(month);
    prev = `/auswertung?zeitraum=monat&monat=${shiftMonth(month, -1)}`;
    if (month < today.slice(0, 7)) next = `/auswertung?zeitraum=monat&monat=${shiftMonth(month, 1)}`;
  }

  const [k, cats, trend, merchants, items, weekdays] = await Promise.all([
    kpis(range),
    spendingByCategory(range),
    monthlyTrend(12),
    topMerchants(range),
    topItems(range),
    spendingByWeekday(range),
  ]);
  const trendRows = trend.map((t) => ({ ...t, label: monthName(t.month, true) }));
  const nonZero = trend.filter((t) => t.total > 0);
  const avgMonth = nonZero.length ? nonZero.reduce((s, t) => s + t.total, 0) / nonZero.length : 0;

  const tab = (p: Period, label: string) => (
    <Link href={`/auswertung?zeitraum=${p}`} className={period === p ? "active" : undefined}>
      {label}
    </Link>
  );

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Auswertung</h1>
        <a className="btn" href={`/api/export?from=${range.from}&to=${range.to}`}>
          ⬇️ CSV-Export
        </a>
      </div>

      <AskBox />

      <div className="spread">
        <div className="tabs">
          {tab("monat", "Monat")}
          {tab("jahr", "Jahr")}
          {tab("12m", "12 Monate")}
          {tab("frei", "Zeitraum")}
        </div>
        {period === "frei" ? (
          <form className="row" method="get">
            <input type="hidden" name="zeitraum" value="frei" />
            <input type="date" name="von" defaultValue={range.from} aria-label="Von" />
            <input type="date" name="bis" defaultValue={range.to} aria-label="Bis" />
            <button className="btn">Anzeigen</button>
          </form>
        ) : (
          <div className="row">
            {prev && (
              <Link className="btn small" href={prev} aria-label="Zurück">
                ←
              </Link>
            )}
            <strong>{title}</strong>
            {next && (
              <Link className="btn small" href={next} aria-label="Weiter">
                →
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-kpi">
        <div className="card kpi">
          <div className="label">Ausgaben</div>
          <div className="value">{eur(k.total)}</div>
          <div className="sub">{title}</div>
        </div>
        <div className="card kpi">
          <div className="label">Einkäufe</div>
          <div className="value">{k.receipts}</div>
          <div className="sub">Ø {k.receipts ? eur(k.total / k.receipts) : "–"}</div>
        </div>
        <div className="card kpi">
          <div className="label">Artikel</div>
          <div className="value">{k.items}</div>
          <div className="sub">bei {k.merchants} Geschäften</div>
        </div>
        <div className="card kpi">
          <div className="label">Ø pro Monat</div>
          <div className="value">{eur(avgMonth)}</div>
          <div className="sub">letzte 12 Monate</div>
        </div>
      </div>

      <section className="card">
        <h2>Verlauf der letzten 12 Monate</h2>
        <MonthlyChart data={trendRows} />
      </section>

      <section className="card">
        <h2>Ausgaben nach Kategorie</h2>
        <CategoryBars data={cats} showChildren linkRange={range} />
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2>Top-Geschäfte</h2>
          {merchants.length === 0 ? (
            <p className="muted">Keine Daten.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Geschäft</th>
                  <th className="right">Einkäufe</th>
                  <th className="right">Summe</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((m) => (
                  <tr key={m.merchant}>
                    <td>
                      <Link href={`/belege?q=${encodeURIComponent(m.merchant)}&von=${range.from}&bis=${range.to}`}>{m.merchant}</Link>
                    </td>
                    <td className="right num">{m.receipts}</td>
                    <td className="right num">{eur(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2>Teuerste Artikel</h2>
          {items.length === 0 ? (
            <p className="muted">Keine Daten.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Artikel</th>
                  <th className="right">Anzahl</th>
                  <th className="right">Summe</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <Link href={`/belege?q=${encodeURIComponent(m.name)}`}>{m.name}</Link>
                    </td>
                    <td className="right num">{m.count}×</td>
                    <td className="right num">{eur(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Ausgaben nach Wochentag</h2>
        <SimpleBarChart data={weekdays} />
      </section>
    </div>
  );
}
