import Link from "next/link";
import type { BackupStatus } from "@/lib/backup";

function when(d: Date | null) {
  return d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "nie";
}

/** Warnung auf der Übersicht – nur wenn etwas zu tun ist. */
export function BackupWarning({ status, hasReceipts }: { status: BackupStatus; hasReceipts: boolean }) {
  if (status.state === "error") {
    return (
      <Link href="/einstellungen#sicherung" className="alert bad" style={{ display: "block" }}>
        💾 Sicherung fehlgeschlagen: {status.message} – Details →
      </Link>
    );
  }
  if (status.state === "stale") {
    return (
      <Link href="/einstellungen#sicherung" className="alert" style={{ display: "block" }}>
        💾 Letzte erfolgreiche Sicherung: {when(status.lastSuccess)} – läuft der Backup-Dienst? →
      </Link>
    );
  }
  if (status.state === "ok" && !status.offsite && hasReceipts) {
    return (
      <Link href="/einstellungen#sicherung" className="small muted" style={{ display: "block" }}>
        💾 Belege werden nur auf dem Server selbst gesichert. Sicherung außer Haus einrichten →
      </Link>
    );
  }
  return null;
}

export function BackupDetails({ status }: { status: BackupStatus }) {
  const badge =
    status.state === "ok" ? (
      <span className="badge good">✓ aktuell</span>
    ) : status.state === "none" ? (
      <span className="badge">noch nicht gelaufen</span>
    ) : status.state === "stale" ? (
      <span className="badge warn">veraltet</span>
    ) : (
      <span className="badge bad">✕ Fehler</span>
    );
  return (
    <>
      <table>
        <tbody>
          <tr>
            <td>Status</td>
            <td>{badge}</td>
          </tr>
          <tr>
            <td>Letzte erfolgreiche Sicherung</td>
            <td>{when(status.lastSuccess)}</td>
          </tr>
          <tr>
            <td>Außer Haus</td>
            <td>
              {status.offsite ? (
                <span className="badge good">✓ verschlüsselt (restic)</span>
              ) : (
                <span className="badge warn">nicht eingerichtet</span>
              )}
            </td>
          </tr>
          {status.state === "error" && status.message && (
            <tr>
              <td>Fehler</td>
              <td className="small" style={{ color: "var(--bad)", overflowWrap: "anywhere" }}>
                {status.message}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {status.state === "none"
          ? "Die Sicherung läuft jede Nacht (Standard 3 Uhr). Sofort sichern: docker compose run --rm backup now"
          : status.state === "error" || status.state === "stale"
            ? "Ursache beheben (Details: docker compose logs backup) und dann testen mit: docker compose run --rm backup now"
          : !status.offsite
            ? "Die Datenbank wird täglich nach ./backups gesichert – auf derselben Festplatte. Fällt sie aus, sind alle Belege weg. Richte RESTIC_REPOSITORY in der .env ein (README, Abschnitt „Backup“)."
            : "Datenbank und Originalbelege werden täglich verschlüsselt außer Haus gesichert (7 Tage, 8 Wochen, 24 Monate)."}
      </p>
    </>
  );
}
