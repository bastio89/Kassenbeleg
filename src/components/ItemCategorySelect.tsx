"use client";

import { useTransition } from "react";
import { setItemCategoryAction } from "@/app/actions";

export interface CategoryOption {
  id: number;
  label: string;
  group: string | null;
}

/** Kategorie direkt per Auswahl ändern; die Zuordnung wird für künftige Belege gelernt. */
export function ItemCategorySelect({
  itemId,
  value,
  options,
}: {
  itemId: number;
  value: number | null;
  options: CategoryOption[];
}) {
  const [pending, start] = useTransition();
  const groups = new Map<string, CategoryOption[]>();
  for (const o of options) {
    const key = o.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return (
    <select
      aria-label="Kategorie"
      defaultValue={value ?? ""}
      disabled={pending}
      onChange={(e) => {
        const id = Number(e.target.value);
        if (id) start(() => setItemCategoryAction(itemId, id));
      }}
    >
      {value === null && <option value="">– keine –</option>}
      {[...groups.entries()].map(([group, opts]) =>
        group ? (
          <optgroup key={group} label={group}>
            {opts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}
