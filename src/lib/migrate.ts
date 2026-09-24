import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";

/** Führt alle noch nicht angewendeten SQL-Dateien aus ./migrations aus. */
export async function migrate(sql: postgres.Sql, dir = path.resolve("migrations")): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // Verhindert, dass App und Worker gleichzeitig migrieren
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4711)`;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const content = await readFile(path.join(dir, file), "utf8");
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  });
  return applied;
}
