"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const OTHER = "Übrige";

const fmt = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtShort = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} T€` : `${Math.round(n)} €`;

interface MonthRow {
  label: string;
  total: number;
  byCategory: Record<string, number>;
}

/** Gestapelte Monatsbalken: die 5 größten Kategorien einzeln, der Rest als "Übrige". */
export function MonthlyChart({ data }: { data: MonthRow[] }) {
  const totals = new Map<string, number>();
  for (const m of data) for (const [k, v] of Object.entries(m.byCategory)) totals.set(k, (totals.get(k) ?? 0) + v);
  const top = [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SERIES.length)
    .map(([k]) => k);
  const hasOther = [...totals.keys()].some((k) => !top.includes(k) && (totals.get(k) ?? 0) > 0);
  const keys = hasOther ? [...top, OTHER] : top;
  const color = (k: string) => (k === OTHER ? "var(--series-other)" : SERIES[top.indexOf(k)]);
  const rows = data.map((m) => {
    const row: Record<string, number | string> = { label: m.label, total: m.total };
    let other = 0;
    for (const [k, v] of Object.entries(m.byCategory)) {
      if (top.includes(k)) row[k] = Math.max(0, v);
      else other += v;
    }
    if (hasOther) row[OTHER] = Math.max(0, Math.round(other * 100) / 100);
    return row;
  });

  if (!keys.length) return <p className="muted">Noch keine Daten.</p>;
  return (
    <div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} width={56} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="chart-tooltip">
                    <strong>{label}</strong> · {fmt(Number(payload[0].payload.total))}
                    {[...payload].reverse().map((p) =>
                      Number(p.value) > 0 ? (
                        <div key={String(p.dataKey)} className="row" style={{ gap: 6 }}>
                          <i style={{ width: 8, height: 8, borderRadius: 2, background: color(String(p.dataKey)), display: "inline-block" }} />
                          {String(p.dataKey)}: {fmt(Number(p.value))}
                        </div>
                      ) : null,
                    )}
                  </div>
                ) : null
              }
            />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="a"
                fill={color(k)}
                stroke="var(--surface)"
                strokeWidth={1}
                radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        {keys.map((k) => (
          <span key={k}>
            <i style={{ background: color(k) }} />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Einfarbige Balken (z. B. Ausgaben je Wochentag). */
export function SimpleBarChart({ data }: { data: { name: string; total: number; receipts: number }[] }) {
  if (!data.some((d) => d.total > 0)) return <p className="muted">Noch keine Daten.</p>;
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fill: "var(--muted)", fontSize: 12 }} />
          <YAxis tickFormatter={fmtShort} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} width={56} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <strong>{label}</strong>: {fmt(Number(payload[0].value))}
                  <div className="muted">{String(payload[0].payload.receipts)} Einkäufe</div>
                </div>
              ) : null
            }
          />
          <Bar dataKey="total" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
