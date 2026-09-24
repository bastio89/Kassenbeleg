import Link from "next/link";
import { eur } from "@/lib/format";
import type { CategorySum } from "@/lib/queries";

/** Horizontale Balken je Hauptkategorie – optional mit Unterkategorien. */
export function CategoryBars({
  data,
  showChildren = false,
  limit,
  linkRange,
}: {
  data: CategorySum[];
  showChildren?: boolean;
  limit?: number;
  linkRange?: { from: string; to: string };
}) {
  const rows = limit ? data.slice(0, limit) : data;
  const positive = rows.filter((r) => r.total > 0);
  if (!positive.length) return <p className="muted">Noch keine Ausgaben in diesem Zeitraum.</p>;
  const max = Math.max(...positive.map((r) => r.total));
  const sum = data.reduce((s, r) => s + Math.max(0, r.total), 0);
  const href = (id: number) =>
    linkRange ? `/belege?kategorie=${id}&von=${linkRange.from}&bis=${linkRange.to}` : `/belege?kategorie=${id}`;
  return (
    <div className="bars">
      {positive.map((c) => (
        <div key={c.id}>
          <div className="bar-row" title={`${c.name}: ${eur(c.total)} (${Math.round((c.total / sum) * 100)} %)`}>
            <Link href={href(c.id)} className="bar-label" style={{ color: "var(--text)" }}>
              {c.icon} {c.name}
            </Link>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(c.total / max) * 100}%` }} />
            </div>
            <div className="num small">
              {eur(c.total)} <span className="muted">{Math.round((c.total / sum) * 100)} %</span>
            </div>
          </div>
          {showChildren && c.children.filter((ch) => ch.total > 0).length > 1 && (
            <div className="bar-sub">
              {c.children
                .filter((ch) => ch.total > 0)
                .map((ch) => (
                  <div key={ch.id} className="bar-row" title={`${ch.name}: ${eur(ch.total)}`}>
                    <Link href={href(ch.id)} className="bar-label" style={{ color: "var(--text-2)", paddingLeft: 24 }}>
                      {ch.name}
                    </Link>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(ch.total / max) * 100}%` }} />
                    </div>
                    <div className="num">{eur(ch.total)}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
