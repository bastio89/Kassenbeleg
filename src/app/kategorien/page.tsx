import Link from "next/link";
import { createCategoryAction, deleteCategoryAction, deleteRuleAction, updateCategoryAction } from "@/app/actions";
import { CategoryOptions } from "@/components/CategorySelect";
import { ConfirmButton } from "@/components/ConfirmButton";
import { buildLookup, buildTree, getCategories, type Category } from "@/lib/categories";
import { sql } from "@/lib/db";

function CategoryForm({ c, fallbackId, tree }: { c: Category; fallbackId: number | null; tree: ReturnType<typeof buildTree> }) {
  return (
    <details>
      <summary>bearbeiten</summary>
      <form action={updateCategoryAction} className="form-grid">
        <input type="hidden" name="id" value={c.id} />
        <label className="field">
          Name
          <input name="name" defaultValue={c.name} required />
        </label>
        {c.parent_id === null && (
          <>
            <label className="field">
              Symbol (Emoji)
              <input name="icon" defaultValue={c.icon ?? ""} maxLength={4} />
            </label>
            <label className="field">
              Farbe
              <input name="color" type="color" defaultValue={c.color ?? "#6b7280"} />
            </label>
          </>
        )}
        <label className="field">
          Garantie (Monate)
          <input name="default_warranty_months" type="number" min={0} max={240} defaultValue={c.default_warranty_months} />
        </label>
        <div className="row" style={{ gridColumn: "1 / -1" }}>
          <button className="btn primary small">Speichern</button>
        </div>
      </form>
      {c.id !== fallbackId && (
        <form action={deleteCategoryAction} className="row" style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={c.id} />
          <select name="move_to" defaultValue={fallbackId ?? ""} aria-label="Artikel verschieben nach">
            <CategoryOptions tree={tree} />
          </select>
          <ConfirmButton className="btn danger small" message={`Kategorie „${c.name}“ löschen? Die Artikel werden in die gewählte Kategorie verschoben.`}>
            Löschen & Artikel verschieben
          </ConfirmButton>
        </form>
      )}
    </details>
  );
}

export default async function CategoriesPage() {
  const categories = await getCategories();
  const tree = buildTree(categories);
  const lookup = buildLookup(categories);
  const counts = new Map(
    (await sql<{ category_id: number; n: number }[]>`
      SELECT category_id, count(*)::int AS n FROM receipt_items WHERE category_id IS NOT NULL GROUP BY category_id`).map(
      (r) => [r.category_id, r.n],
    ),
  );
  const rules = await sql<{ id: number; pattern: string; category_id: number; hits: number }[]>`
    SELECT id, pattern, category_id, hits FROM category_rules ORDER BY created_at DESC LIMIT 200`;

  return (
    <div className="stack">
      <div>
        <Link href="/einstellungen" className="small">
          ← Einstellungen
        </Link>
        <h1 style={{ margin: "4px 0 0" }}>Kategorien</h1>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Die KI ordnet jeden Artikel automatisch einer dieser Kategorien zu. Neue Kategorien werden ab dem nächsten Beleg
        berücksichtigt. „Garantie (Monate)“ legt fest, ob Artikel der Kategorie automatisch mit Garantie erfasst werden
        (0 = nur wenn die KI den Artikel als langlebig erkennt).
      </p>

      <section className="card">
        <h2>Neue Kategorie</h2>
        <form action={createCategoryAction} className="form-grid">
          <label className="field">
            Name
            <input name="name" required placeholder="z. B. Urlaub" />
          </label>
          <label className="field">
            Unterkategorie von
            <select name="parent_id" defaultValue="">
              <option value="">– Hauptkategorie –</option>
              {tree.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.icon} {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Symbol (nur Hauptkategorie)
            <input name="icon" maxLength={4} placeholder="🏖️" />
          </label>
          <label className="field">
            Garantie (Monate)
            <input name="default_warranty_months" type="number" min={0} max={240} placeholder="wie übergeordnet" />
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn primary">Anlegen</button>
          </div>
        </form>
      </section>

      {tree.map((root) => (
        <section key={root.id} className="card">
          <div className="spread">
            <h2 style={{ margin: 0 }}>
              <span className="dot" style={{ background: root.color ?? "var(--muted)", marginRight: 8 }} />
              {root.icon} {root.name}
            </h2>
            <span className="small muted">
              {root.default_warranty_months > 0 && `🛡️ ${root.default_warranty_months} Mon. · `}
              {counts.get(root.id) ?? 0} Artikel direkt
            </span>
          </div>
          <CategoryForm c={root} fallbackId={lookup.fallbackId} tree={tree} />
          {root.children.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {root.children.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      <CategoryForm c={c} fallbackId={lookup.fallbackId} tree={tree} />
                    </td>
                    <td className="right small muted num">
                      {c.default_warranty_months > 0 && `🛡️ ${c.default_warranty_months} Mon. · `}
                      {counts.get(c.id) ?? 0} Artikel
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      <section className="card">
        <h2>Gelernte Zuordnungen ({rules.length})</h2>
        <p className="small muted">
          Wenn du bei einem Artikel die Kategorie änderst, merkt sich das System den Artikelnamen und ordnet ihn künftig
          direkt richtig zu – ohne KI.
        </p>
        {rules.length === 0 ? (
          <p className="muted">Noch keine.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Kategorie</th>
                <th className="right">Genutzt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.pattern}</td>
                  <td className="small">{lookup.byId.get(r.category_id)?.path}</td>
                  <td className="right num small">{r.hits}×</td>
                  <td className="right">
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn small" aria-label="Regel löschen">
                        ✕
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
