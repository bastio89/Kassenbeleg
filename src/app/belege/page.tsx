import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CategoryOptions } from "@/components/CategorySelect";
import { ReceiptRow } from "@/components/ReceiptRow";
import { buildTree, getCategories } from "@/lib/categories";
import { eur } from "@/lib/format";
import { listReceipts } from "@/lib/queries";

const PAGE_SIZE = 30;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ReceiptsPage({ searchParams }: PageProps<"/belege">) {
  const sp = await searchParams;
  const q = first(sp.q) ?? "";
  const categoryId = Number(first(sp.kategorie)) || undefined;
  const from = first(sp.von) || undefined;
  const to = first(sp.bis) || undefined;
  const review = first(sp.pruefen) === "1";
  const page = Math.max(1, Number(first(sp.seite)) || 1);
  const validDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

  const [{ rows, total }, categories] = await Promise.all([
    listReceipts({
      q,
      categoryId,
      from: validDate(from),
      to: validDate(to),
      review,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getCategories(),
  ]);
  const tree = buildTree(categories);
  const busy = rows.some((r) => r.status === "pending" || r.status === "processing");
  const pageSum = rows.reduce((s, r) => s + (r.total ? Number(r.total) : 0), 0);
  const pages = Math.ceil(total / PAGE_SIZE);

  const link = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (categoryId) params.set("kategorie", String(categoryId));
    if (from) params.set("von", from);
    if (to) params.set("bis", to);
    if (review) params.set("pruefen", "1");
    params.set("seite", String(p));
    return `/belege?${params}`;
  };

  return (
    <div className="stack">
      <AutoRefresh active={busy} />
      <h1>Belege</h1>
      <form className="card stack" style={{ gap: 12 }} method="get">
        <div className="row">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Suchen: Artikel, Geschäft, Notiz … z. B. „Waschmaschine“"
            style={{ flex: 1, minWidth: 200 }}
            autoFocus={!q}
          />
          <button className="btn primary" type="submit">
            🔍 Suchen
          </button>
        </div>
        <div className="form-grid">
          <label className="field">
            Kategorie
            <select name="kategorie" defaultValue={categoryId ?? ""}>
              <option value="">Alle</option>
              <CategoryOptions tree={tree} />
            </select>
          </label>
          <label className="field">
            Von
            <input type="date" name="von" defaultValue={from} />
          </label>
          <label className="field">
            Bis
            <input type="date" name="bis" defaultValue={to} />
          </label>
          <label className="field" style={{ justifyContent: "flex-end" }}>
            <span className="row" style={{ minHeight: 40 }}>
              <input type="checkbox" name="pruefen" value="1" defaultChecked={review} style={{ minHeight: 0 }} />
              Nur zu prüfende
            </span>
          </label>
        </div>
      </form>

      <div className="spread small muted">
        <span>
          {total} {total === 1 ? "Beleg" : "Belege"}
          {rows.length > 0 && ` · ${eur(pageSum)} auf dieser Seite`}
        </span>
        {(q || categoryId || from || to || review) && <Link href="/belege">Filter zurücksetzen</Link>}
      </div>

      {rows.length === 0 ? (
        <div className="card empty">Keine Belege gefunden.</div>
      ) : (
        <div className="receipt-list">
          {rows.map((r) => (
            <ReceiptRow key={r.id} r={r} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center" }}>
          {page > 1 && (
            <Link className="btn small" href={link(page - 1)}>
              ← Zurück
            </Link>
          )}
          <span className="muted small">
            Seite {page} von {pages}
          </span>
          {page < pages && (
            <Link className="btn small" href={link(page + 1)}>
              Weiter →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
