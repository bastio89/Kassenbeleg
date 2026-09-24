import postgres from "postgres";
import { config } from "./config";

// In Next.js-Dev-Mode wird das Modul mehrfach geladen – Verbindung global cachen
const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

export const sql =
  globalForDb.__sql ??
  postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;
