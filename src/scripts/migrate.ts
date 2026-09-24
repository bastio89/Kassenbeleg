import { sql } from "../lib/db";
import { migrate } from "../lib/migrate";

const applied = await migrate(sql);
console.log(applied.length ? `Migrationen angewendet: ${applied.join(", ")}` : "Datenbank ist aktuell.");
await sql.end();
