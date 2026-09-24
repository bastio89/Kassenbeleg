import { sql } from "./db";

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  icon: string | null;
  color: string | null;
  default_warranty_months: number;
  sort_order: number;
}

export interface CategoryNode extends Category {
  children: Category[];
  /** "Hauptkategorie > Unterkategorie" bzw. nur "Hauptkategorie" */
  path: string;
}

export async function getCategories(): Promise<Category[]> {
  return sql<Category[]>`
    SELECT id, name, parent_id, icon, color, default_warranty_months, sort_order
    FROM categories ORDER BY sort_order, name`;
}

export function buildTree(categories: Category[]): CategoryNode[] {
  const roots = categories.filter((c) => c.parent_id === null);
  return roots.map((r) => ({
    ...r,
    path: r.name,
    children: categories.filter((c) => c.parent_id === r.id),
  }));
}

export interface CategoryLookup {
  byId: Map<number, Category & { path: string; root: Category }>;
  byPath: Map<string, number>;
  /** Auswählbare Kategorien für die KI: Unterkategorien bzw. Hauptkategorien ohne Unterkategorien */
  paths: string[];
  fallbackId: number | null;
}

export function buildLookup(categories: Category[]): CategoryLookup {
  const byId: CategoryLookup["byId"] = new Map();
  const byPath = new Map<string, number>();
  const paths: string[] = [];
  const parents = new Map(categories.map((c) => [c.id, c]));
  for (const c of categories) {
    const parent = c.parent_id ? parents.get(c.parent_id) : undefined;
    const path = parent ? `${parent.name} > ${c.name}` : c.name;
    byId.set(c.id, { ...c, path, root: parent ?? c });
    byPath.set(path.toLowerCase(), c.id);
  }
  const fallbackId =
    byPath.get("sonstiges > nicht zugeordnet") ?? byPath.get("sonstiges") ?? categories[0]?.id ?? null;
  for (const root of categories.filter((c) => c.parent_id === null)) {
    const children = categories.filter((c) => c.parent_id === root.id);
    if (children.length === 0) paths.push(root.name);
    // Die Auffang-Kategorie wird der KI nicht angeboten – sonst nutzt ein kleines Modell sie als bequemen Ausweg
    else for (const child of children) if (child.id !== fallbackId) paths.push(`${root.name} > ${child.name}`);
  }
  return { byId, byPath, paths, fallbackId };
}

/** Findet eine Kategorie zu einem (evtl. leicht abweichend geschriebenen) Pfad. */
export function resolveCategoryPath(lookup: CategoryLookup, path: string): number | null {
  const key = path.trim().toLowerCase();
  const exact = lookup.byPath.get(key);
  if (exact) return exact;
  // Nur Unterkategorie genannt?
  const last = key.split(">").pop()!.trim();
  for (const [p, id] of lookup.byPath) {
    if (p.endsWith(`> ${last}`) || p === last) return id;
  }
  return null;
}
