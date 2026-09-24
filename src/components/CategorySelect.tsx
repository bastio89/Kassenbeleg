import type { CategoryNode } from "@/lib/categories";

/** Optionen für ein <select> mit Haupt- und Unterkategorien. */
export function CategoryOptions({ tree, leavesOnly = false }: { tree: CategoryNode[]; leavesOnly?: boolean }) {
  return (
    <>
      {tree.map((root) =>
        root.children.length === 0 ? (
          <option key={root.id} value={root.id}>
            {root.icon} {root.name}
          </option>
        ) : (
          <optgroup key={root.id} label={`${root.icon ?? ""} ${root.name}`}>
            {!leavesOnly && <option value={root.id}>{root.name} (alle)</option>}
            {root.children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </>
  );
}
