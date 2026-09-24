import Link from "next/link";
import { BackupDetails } from "@/components/BackupNotice";
import { backupStatus } from "@/lib/backup";
import { hasModel, ollamaStatus } from "@/lib/ai/ollama";
import { config, effectiveMode } from "@/lib/config";
import { queueStatus } from "@/lib/queries";

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`badge ${ok ? "good" : "bad"}`}>
      {ok ? "✓" : "✕"} {children}
    </span>
  );
}

export default async function SettingsPage() {
  const [queue, ollama, backup] = await Promise.all([queueStatus(), ollamaStatus(), backupStatus()]);
  const mode = effectiveMode(config.ai.provider);
  const model = mode === "vision" ? config.ai.ollama.visionModel : config.ai.ollama.model;
  const usesOllama = config.ai.provider === "ollama";

  return (
    <div className="stack">
      <h1>Einstellungen</h1>

      <div className="grid grid-2">
        <Link href="/kategorien" className="card" style={{ color: "var(--text)" }}>
          <h2 style={{ marginBottom: 4 }}>🏷️ Kategorien</h2>
          <span className="muted small">Kategorien anlegen, umbenennen, Garantie-Standards & gelernte Zuordnungen</span>
        </Link>
        <a href="/api/export" className="card" style={{ color: "var(--text)" }}>
          <h2 style={{ marginBottom: 4 }}>⬇️ Alles exportieren</h2>
          <span className="muted small">Alle Artikel als CSV (Excel-kompatibel)</span>
        </a>
      </div>

      <section className="card">
        <h2>🤖 KI-Auswertung</h2>
        <table>
          <tbody>
            <tr>
              <td>Anbieter</td>
              <td>
                {usesOllama ? "Lokal (Ollama)" : "OpenRouter (Cloud)"}
                {config.ai.fallback && <span className="muted"> · Fallback: {config.ai.fallback}</span>}
              </td>
            </tr>
            <tr>
              <td>Verfahren</td>
              <td>
                {mode === "ocr" ? "Texterkennung (Tesseract) + Sprachmodell" : "Bild direkt an Vision-Modell"}
              </td>
            </tr>
            <tr>
              <td>Modell</td>
              <td>{usesOllama ? model : config.ai.openrouter.model}</td>
            </tr>
            {(usesOllama || config.ai.fallback === "ollama") && (
              <tr>
                <td>Ollama</td>
                <td className="row">
                  <Status ok={ollama.reachable}>{ollama.reachable ? "erreichbar" : `nicht erreichbar`}</Status>
                  {ollama.reachable && (
                    <Status ok={hasModel(ollama.models, model)}>
                      {hasModel(ollama.models, model) ? "Modell geladen" : "Modell wird noch heruntergeladen"}
                    </Status>
                  )}
                </td>
              </tr>
            )}
            {(config.ai.provider === "openrouter" || config.ai.fallback === "openrouter") && (
              <tr>
                <td>OpenRouter</td>
                <td>
                  <Status ok={Boolean(config.ai.openrouter.apiKey)}>
                    {config.ai.openrouter.apiKey ? "API-Schlüssel gesetzt" : "OPENROUTER_API_KEY fehlt"}
                  </Status>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Geändert wird das in der Datei <code>.env</code> auf dem Server (danach <code>docker compose up -d</code>).
        </p>
      </section>

      <section className="card">
        <h2>⚙️ Verarbeitung</h2>
        <div className="row">
          <span className="badge">⏳ {queue.pending} wartend</span>
          <span className="badge">⚙️ {queue.processing} in Arbeit</span>
          <span className="badge good">✓ {queue.done} fertig</span>
          <Link href="/belege?pruefen=1" className="badge warn">
            {queue.review} zu prüfen
          </Link>
          <Link href="/belege?pruefen=1" className="badge warn">
            {queue.duplicates} Duplikate
          </Link>
          <Link href="/belege?pruefen=1" className="badge bad">
            {queue.failed} fehlgeschlagen
          </Link>
        </div>
      </section>

      <section className="card" id="sicherung">
        <h2>💾 Sicherung</h2>
        <BackupDetails status={backup} />
      </section>

      <section className="card">
        <h2>💬 Telegram</h2>
        {config.telegram.token ? (
          <p style={{ margin: 0 }}>
            <Status ok>Bot aktiv</Status>{" "}
            <span className="small muted">
              {config.telegram.allowedUserIds.length} freigegebene(s) Konto/Konten. Neue Personen: dem Bot <code>/id</code>{" "}
              schicken und die ID in <code>TELEGRAM_ALLOWED_USER_IDS</code> eintragen.
            </span>
          </p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Nicht eingerichtet. Siehe README, Abschnitt „Telegram-Bot“.
          </p>
        )}
      </section>

      <section className="card">
        <h2>📱 Als App installieren</h2>
        <p className="small" style={{ margin: 0 }}>
          <strong>iPhone:</strong> In Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.
          <br />
          <strong>Android:</strong> In Chrome öffnen → Menü ⋮ → „App installieren“. Danach kannst du Fotos und PDFs
          direkt über „Teilen → Kassenbelege“ ablegen.
        </p>
      </section>
    </div>
  );
}
