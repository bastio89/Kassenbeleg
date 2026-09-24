import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "./config";
import { backupStatus } from "./backup";

describe("backupStatus", () => {
  beforeEach(async () => {
    config.backupDir = await mkdtemp(path.join(tmpdir(), "backup-"));
  });

  const write = (o: object) => writeFile(path.join(config.backupDir, "status.json"), JSON.stringify(o));

  it("ohne Statusdatei: noch nie gelaufen", async () => {
    expect((await backupStatus()).state).toBe("none");
  });

  it("aktuelle erfolgreiche Sicherung", async () => {
    const now = new Date().toISOString();
    await write({ status: "ok", time: now, last_success: now, offsite: true, message: "lokal + außer Haus" });
    expect(await backupStatus()).toMatchObject({ state: "ok", offsite: true });
  });

  it("letzte erfolgreiche Sicherung älter als 48 Stunden", async () => {
    const old = new Date(Date.now() - 3 * 86400_000).toISOString();
    await write({ status: "ok", time: old, last_success: old, offsite: false });
    expect((await backupStatus()).state).toBe("stale");
  });

  it("kaputte Statusdatei wird als Fehler gemeldet", async () => {
    await writeFile(path.join(config.backupDir, "status.json"), '{"status":"error","message":"a\tb');
    expect((await backupStatus()).state).toBe("error");
  });

  it("Fehler im letzten Lauf", async () => {
    const now = new Date().toISOString();
    await write({ status: "error", time: now, last_success: now, offsite: true, message: "Falsches RESTIC_PASSWORD" });
    expect(await backupStatus()).toMatchObject({ state: "error", message: "Falsches RESTIC_PASSWORD" });
  });
});
