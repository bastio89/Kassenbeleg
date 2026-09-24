import { spawn } from "node:child_process";

/** Startet ein Kommandozeilenprogramm, schreibt optional in stdin und liefert stdout. */
export function run(cmd: string, args: string[], input?: Buffer, timeoutMs = 180_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} hat das Zeitlimit überschritten`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} konnte nicht gestartet werden: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} beendet mit Code ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
