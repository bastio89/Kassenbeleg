import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export interface BackupStatus {
  /** none = noch nie gelaufen; ok; stale = letzte erfolgreiche Sicherung zu alt; error = letzter Lauf fehlgeschlagen */
  state: "none" | "ok" | "stale" | "error";
  offsite: boolean;
  lastSuccess: Date | null;
  lastRun: Date | null;
  message: string | null;
}

const MAX_AGE_HOURS = 48;

/** Liest den Status, den der Backup-Dienst (docker/backup/backup.sh) nach jedem Lauf schreibt. */
export async function backupStatus(): Promise<BackupStatus> {
  let text: string;
  try {
    text = await readFile(path.join(config.backupDir, "status.json"), "utf8");
  } catch {
    return { state: "none", offsite: false, lastSuccess: null, lastRun: null, message: null };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    // Datei vorhanden, aber kaputt: lieber warnen als "alles gut" anzeigen
    return { state: "error", offsite: false, lastSuccess: null, lastRun: null, message: "Statusdatei der Sicherung ist unlesbar" };
  }
  const date = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const lastSuccess = date(raw.last_success);
  const lastRun = date(raw.time);
  const tooOld = !lastSuccess || Date.now() - lastSuccess.getTime() > MAX_AGE_HOURS * 3600 * 1000;
  return {
    state: raw.status === "error" ? "error" : tooOld ? "stale" : "ok",
    offsite: raw.offsite === true,
    lastSuccess,
    lastRun,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}
