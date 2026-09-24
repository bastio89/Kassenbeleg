import Link from "next/link";
import { dateDe, eur } from "@/lib/format";
import type { ReceiptListItem } from "@/lib/queries";

export function StatusBadge({ status, review, duplicate }: { status: string; review?: boolean; duplicate?: boolean }) {
  if (duplicate) return <span className="badge warn">Duplikat</span>;
  if (status === "pending") return <span className="badge">⏳ Wartet</span>;
  if (status === "processing") return <span className="badge">⚙️ Wird ausgewertet</span>;
  if (status === "failed") return <span className="badge bad">⚠️ Fehlgeschlagen</span>;
  if (review) return <span className="badge warn">Prüfen</span>;
  return null;
}

export function ReceiptRow({ r }: { r: ReceiptListItem }) {
  const cats = r.categories ?? [];
  return (
    <Link href={`/belege/${r.id}`} className="receipt-row">
      {r.preview_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={`/api/files/${r.id}?type=preview`} alt="" loading="lazy" />
      ) : (
        <div className="thumb" aria-hidden>
          {r.mime_type === "application/pdf" ? "📄" : "🧾"}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="title">{r.merchant ?? (r.status === "done" ? "Unbekanntes Geschäft" : "Neuer Beleg")}</div>
        <div className="meta">
          <span>{dateDe(r.effective_date)}</span>
          {r.item_count > 0 && <span>· {r.item_count} Artikel</span>}
          <StatusBadge status={r.status} review={r.needs_review} duplicate={Boolean(r.duplicate_of)} />
          {cats.slice(0, 3).map((c) => (
            <span key={c.name} title={c.name} aria-label={c.name}>
              {c.icon}
            </span>
          ))}
        </div>
        {r.matched_items && r.matched_items.length > 0 && (
          <div className="hits">↳ {r.matched_items.slice(0, 4).join(", ")}</div>
        )}
      </div>
      <div className="amount">{r.total ? eur(r.total, r.currency) : ""}</div>
    </Link>
  );
}
