import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addItemAction,
  deleteItemAction,
  deleteReceiptAction,
  markReviewedAction,
  notDuplicateAction,
  reprocessAction,
  updateItemAction,
  updateReceiptAction,
} from "@/app/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CategoryOptions } from "@/components/CategorySelect";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ItemCategorySelect, type CategoryOption } from "@/components/ItemCategorySelect";
import { StatusBadge } from "@/components/ReceiptRow";
import { buildLookup, buildTree, getCategories } from "@/lib/categories";
import { dateDe, eur, fileSize, todayIso } from "@/lib/format";
import { getReceipt, receiptSummary } from "@/lib/queries";

const SOURCE: Record<string, string> = { web: "Web-App", telegram: "Telegram", share: "Teilen-Menü" };

export default async function ReceiptPage({ params }: PageProps<"/belege/[id]">) {
  const { id } = await params;
  const [data, categories] = await Promise.all([getReceipt(id), getCategories()]);
  if (!data) notFound();
  const { receipt: r, items } = data;
  const original = r.duplicate_of ? await receiptSummary(r.duplicate_of) : null;
  const tree = buildTree(categories);
  const lookup = buildLookup(categories);
  const options: CategoryOption[] = tree.flatMap<CategoryOption>((root) =>
    root.children.length
      ? root.children.map((c) => ({ id: c.id, label: c.name, group: `${root.icon ?? ""} ${root.name}` }))
      : [{ id: root.id, label: `${root.icon ?? ""} ${root.name}`, group: null }],
  );
  // Artikel, die direkt einer Hauptkategorie mit Unterkategorien zugeordnet sind, auswählbar halten
  for (const it of items) {
    if (it.category_id && !options.some((o) => o.id === it.category_id)) {
      const c = lookup.byId.get(it.category_id);
      if (c) options.unshift({ id: c.id, label: c.path, group: null });
    }
  }
  const busy = r.status === "pending" || r.status === "processing";
  const itemSum = items.reduce((s, i) => s + Number(i.total_price), 0);
  const today = todayIso();
  const isPdf = r.mime_type === "application/pdf";
  const isHeic = r.mime_type === "image/heic" || r.mime_type === "image/heif";

  return (
    <div className="stack">
      <AutoRefresh active={busy} intervalMs={3000} />
      <div className="spread">
        <div>
          <Link href="/belege" className="small">
            ← Belege
          </Link>
          <h1 style={{ margin: "4px 0 0" }}>{r.merchant ?? (busy ? "Wird ausgewertet …" : "Unbekanntes Geschäft")}</h1>
          <div className="row small muted">
            <span>{dateDe(r.purchase_date)}</span>
            {r.purchase_time && <span>{r.purchase_time} Uhr</span>}
            {r.total && <strong style={{ color: "var(--text)" }}>{eur(r.total, r.currency)}</strong>}
            <StatusBadge status={r.status} review={r.needs_review} duplicate={Boolean(r.duplicate_of)} />
          </div>
        </div>
        <div className="row">
          <a className="btn" href={`/api/files/${r.id}?download=1`}>
            ⬇️ Original
          </a>
        </div>
      </div>

      {r.status === "failed" && (
        <div className="alert bad">
          <strong>Auswertung fehlgeschlagen:</strong> {r.error}
          <form action={reprocessAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn small">🔄 Erneut versuchen</button>
          </form>
        </div>
      )}
      {original && (
        <div className="alert">
          <strong>Mögliches Duplikat:</strong> Dieser Beleg sieht aus wie{" "}
          <Link href={`/belege/${original.id}`}>
            {original.merchant ?? "Beleg"} vom {dateDe(original.purchase_date)} über {eur(original.total, original.currency)}
          </Link>{" "}
          (erfasst am {original.created_at.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}). Er wird in
          Auswertungen und Garantien nicht mitgezählt.
          <div className="row" style={{ marginTop: 8 }}>
            <form action={deleteReceiptAction}>
              <input type="hidden" name="id" value={r.id} />
              <button className="btn small">🗑️ Duplikat löschen</button>
            </form>
            <form action={notDuplicateAction}>
              <input type="hidden" name="id" value={r.id} />
              <button className="btn small">Kein Duplikat – mitzählen</button>
            </form>
          </div>
        </div>
      )}
      {r.status === "done" && r.needs_review && !original && (
        <div className="alert">
          <strong>Bitte prüfen:</strong> {r.review_reason}
          <form action={markReviewedAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn small">✓ Passt so</button>
          </form>
        </div>
      )}

      <div className="detail">
        <div className="preview card" style={{ padding: 8 }}>
          {r.preview_path ? (
            <a href={`/api/files/${r.id}`} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${r.id}?type=preview`} alt="Beleg" />
            </a>
          ) : isPdf || isHeic ? (
            // HEIC können die meisten Browser nicht anzeigen – bis die Vorschau erzeugt ist, nur Download
            <a href={`/api/files/${r.id}${isHeic ? "?download=1" : ""}`} target="_blank" rel="noreferrer" className="empty" style={{ display: "block" }}>
              {isPdf ? "📄 PDF öffnen" : "📷 HEIC-Foto herunterladen"}
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${r.id}`} alt="Beleg" />
          )}
          <div className="small muted" style={{ padding: "8px 4px 0" }}>
            {r.original_filename ?? (isPdf ? "PDF" : "Foto")} · {fileSize(r.file_size)} · via {SOURCE[r.source] ?? r.source}
            {r.uploaded_by ? ` (${r.uploaded_by})` : ""}
          </div>
        </div>

        <div className="stack">
          <section className="card">
            <div className="spread" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Artikel ({items.length})</h2>
              <span className="small muted num">
                Summe {eur(itemSum, r.currency)}
                {r.total && Math.abs(itemSum - Number(r.total)) > 0.05 && (
                  <span className="badge warn" style={{ marginLeft: 6 }}>
                    ≠ {eur(r.total, r.currency)}
                  </span>
                )}
              </span>
            </div>
            {items.length === 0 && <p className="muted">{busy ? "Wird ausgewertet …" : "Keine Artikel erfasst."}</p>}
            {items.map((it) => {
              const expired = it.warranty_until && it.warranty_until < today;
              return (
                <div key={it.id} className="item">
                  <div className="item-main">
                    <div className="item-name">
                      {it.name}
                      {Number(it.quantity) !== 1 && (
                        <span className="muted small">
                          {" "}
                          · {Number(it.quantity).toLocaleString("de-DE")} × {it.unit_price ? eur(it.unit_price) : ""}
                        </span>
                      )}
                      {it.notes && <div className="small muted">{it.notes}</div>}
                    </div>
                    <div className="num" style={{ fontWeight: 600 }}>
                      {eur(it.total_price, r.currency)}
                    </div>
                  </div>
                  <div className="item-sub">
                    <ItemCategorySelect itemId={it.id} value={it.category_id} options={options} />
                    {it.category_source === "rule" && <span className="badge" title="Aus einer früheren Korrektur gelernt">gelernt</span>}
                    {it.warranty_until && (
                      <span className={`badge ${expired ? "" : "good"}`}>
                        🛡️ {expired ? "Garantie abgelaufen" : `Garantie bis ${dateDe(it.warranty_until)}`}
                      </span>
                    )}
                    <details>
                      <summary>bearbeiten</summary>
                      <form action={updateItemAction} className="form-grid">
                        <input type="hidden" name="item_id" value={it.id} />
                        <label className="field" style={{ gridColumn: "1 / -1" }}>
                          Bezeichnung
                          <input name="name" defaultValue={it.name} required />
                        </label>
                        <label className="field">
                          Menge
                          <input name="quantity" inputMode="decimal" defaultValue={Number(it.quantity).toLocaleString("de-DE")} />
                        </label>
                        <label className="field">
                          Einzelpreis
                          <input name="unit_price" inputMode="decimal" defaultValue={it.unit_price?.replace(".", ",") ?? ""} />
                        </label>
                        <label className="field">
                          Preis
                          <input name="total_price" inputMode="decimal" defaultValue={it.total_price.replace(".", ",")} required />
                        </label>
                        <label className="field">
                          Garantie (Monate)
                          <input name="warranty_months" type="number" min={0} max={240} defaultValue={it.warranty_months ?? ""} placeholder="keine" />
                        </label>
                        <label className="field" style={{ gridColumn: "1 / -1" }}>
                          Notiz (z. B. Seriennummer)
                          <input name="notes" defaultValue={it.notes ?? ""} />
                        </label>
                        <div className="row">
                          <button className="btn primary small">Speichern</button>
                          <button className="btn danger small" formAction={deleteItemAction}>
                            Löschen
                          </button>
                        </div>
                      </form>
                    </details>
                  </div>
                </div>
              );
            })}
            {!busy && (
              <details style={{ marginTop: 12 }}>
                <summary>+ Artikel hinzufügen</summary>
                <form action={addItemAction} className="form-grid">
                  <input type="hidden" name="receipt_id" value={r.id} />
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    Bezeichnung
                    <input name="name" required />
                  </label>
                  <label className="field">
                    Menge
                    <input name="quantity" inputMode="decimal" defaultValue="1" />
                  </label>
                  <label className="field">
                    Preis
                    <input name="total_price" inputMode="decimal" required />
                  </label>
                  <label className="field">
                    Kategorie
                    <select name="category_id" defaultValue={lookup.fallbackId ?? ""}>
                      <CategoryOptions tree={tree} leavesOnly />
                    </select>
                  </label>
                  <label className="field">
                    Garantie (Monate)
                    <input name="warranty_months" type="number" min={0} max={240} placeholder="keine" />
                  </label>
                  <div>
                    <button className="btn primary small">Hinzufügen</button>
                  </div>
                </form>
              </details>
            )}
          </section>

          <section className="card">
            <details>
              <summary style={{ fontSize: 15 }}>✏️ Belegdaten bearbeiten</summary>
              <form action={updateReceiptAction} className="form-grid">
                <input type="hidden" name="id" value={r.id} />
                <label className="field">
                  Geschäft
                  <input name="merchant" defaultValue={r.merchant ?? ""} />
                </label>
                <label className="field">
                  Adresse
                  <input name="merchant_address" defaultValue={r.merchant_address ?? ""} />
                </label>
                <label className="field">
                  Kaufdatum
                  <input type="date" name="purchase_date" defaultValue={r.purchase_date ?? ""} />
                </label>
                <label className="field">
                  Uhrzeit
                  <input type="time" name="purchase_time" defaultValue={r.purchase_time ?? ""} />
                </label>
                <label className="field">
                  Gesamtbetrag
                  <input name="total" inputMode="decimal" defaultValue={r.total?.replace(".", ",") ?? ""} />
                </label>
                <label className="field">
                  Zahlungsart
                  <input name="payment_method" defaultValue={r.payment_method ?? ""} />
                </label>
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  Notiz
                  <textarea name="notes" defaultValue={r.notes ?? ""} placeholder="z. B. Geschenk für …, Seriennummer, Rechnungsnummer" />
                </label>
                <div>
                  <button className="btn primary">Speichern</button>
                </div>
              </form>
            </details>
            {r.notes && <p className="small" style={{ marginBottom: 0 }}>📝 {r.notes}</p>}
            <dl className="small muted" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: "12px 0 0" }}>
              {r.merchant_address && (
                <>
                  <dt>Adresse</dt>
                  <dd style={{ margin: 0 }}>{r.merchant_address}</dd>
                </>
              )}
              {r.payment_method && (
                <>
                  <dt>Bezahlt mit</dt>
                  <dd style={{ margin: 0 }}>{r.payment_method}</dd>
                </>
              )}
              <dt>Erfasst</dt>
              <dd style={{ margin: 0 }}>{r.created_at.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</dd>
              {r.ai_model && (
                <>
                  <dt>Ausgelesen mit</dt>
                  <dd style={{ margin: 0 }}>
                    {r.ai_model} ({r.ai_provider})
                  </dd>
                </>
              )}
            </dl>
          </section>

          {r.raw_text && (
            <section className="card">
              <details>
                <summary style={{ fontSize: 15 }}>🔤 Erkannter Text</summary>
                <div className="pre">{r.raw_text}</div>
              </details>
            </section>
          )}

          <div className="row">
            {!busy && (
              <form action={reprocessAction}>
                <input type="hidden" name="id" value={r.id} />
                <ConfirmButton className="btn" message="Beleg neu auswerten? Manuelle Änderungen an Artikeln gehen dabei verloren.">
                  🔄 Neu auswerten
                </ConfirmButton>
              </form>
            )}
            <form action={deleteReceiptAction}>
              <input type="hidden" name="id" value={r.id} />
              <ConfirmButton message="Beleg inklusive Originaldatei endgültig löschen?">🗑️ Löschen</ConfirmButton>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
