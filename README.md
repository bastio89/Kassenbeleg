# 🧾 Kassenbelege

Selbst gehostete Belegverwaltung für den Haushalt: **Kassenbon fotografieren → KI liest ihn aus → alles ist kategorisiert, durchsuchbar und für den Garantiefall archiviert.**

- 📷 **Erfassen** per Handy-Kamera (Web-App/PWA), Datei-Upload, „Teilen“-Menü (Android) oder **Telegram-Bot**
- 📄 Fotos (JPG, PNG, WebP, **iPhone-HEIC**) **und** digitale **PDF-Rechnungen** (Online-Shops)
- 🤖 **Lokale KI** (Ollama, läuft auch auf 8-GB-Rechnern) – optional **OpenRouter** als Cloud-Alternative/Fallback
- 🛒 **Jeder Artikel einzeln** erfasst und **automatisch kategorisiert** (erweiterbare Kategorien mit Unterkategorien)
- 🧠 **Lernt mit**: Korrigierst du eine Kategorie, wird der Artikel künftig automatisch richtig zugeordnet
- 📊 **Auswertungen**: Monat/Jahr/Zeitraum, Verlauf über 12 Monate, Kategorien & Unterkategorien, Top-Geschäfte, teuerste Artikel, Wochentage, **CSV-Export** (Excel)
- 🛡️ **Garantie-Archiv**: Gewährleistung wird für langlebige Artikel automatisch berechnet, Übersicht „läuft bald ab“, **Erinnerung per Telegram**
- ♊ **Duplikaterkennung**: Derselbe Bon zweimal fotografiert wird erkannt und nicht doppelt gezählt
- 🔍 **Volltextsuche** über Geschäft, Artikel, Notizen und den kompletten erkannten Belegtext – Original jederzeit herunterladbar
- 🐘 Alles in **PostgreSQL**, Originaldateien unverändert auf der Festplatte, **tägliches Backup**

---

## Inhalt

1. [So funktioniert’s](#so-funktionierts)
2. [Voraussetzungen](#voraussetzungen)
3. [Installation](#installation)
4. [Zugriff vom Handy – sicher mit Tailscale](#zugriff-vom-handy--sicher-mit-tailscale)
5. [Telegram-Bot einrichten](#telegram-bot-einrichten)
6. [KI-Einstellungen & Hardware](#ki-einstellungen--hardware)
7. [Bedienung](#bedienung)
8. [Backup & Wiederherstellung](#backup--wiederherstellung)
9. [Update](#update)
10. [Fehlersuche](#fehlersuche)
11. [Technik & Entwicklung](#technik--entwicklung)

---

## So funktioniert’s

```
Foto / PDF ──► Web-App oder Telegram ──► Originaldatei speichern (unverändert)
                                               │
                                               ▼
                               Worker (im Hintergrund, eins nach dem anderen)
                                 1. Texterkennung: Tesseract (Foto) bzw. PDF-Text
                                 2. Artikelzeilen regelbasiert lesen + gegen Bonsumme prüfen
                                 3. Lokale KI: Geschäft, Datum, Zahlungsart (+ Positionen, falls nötig)
                                 4. Kategorie je Artikel: gelernte Regeln → Stichworte → KI
                                 5. Garantie berechnen (Kaufdatum + Monate der Kategorie)
                                               │
                                               ▼
                                PostgreSQL ──► Web-App / Telegram-Antwort
```

Kleine lokale Modelle machen Fehler. Deshalb prüft die App gegen: Die Summe der Positionen muss zum Gesamtbetrag passen, Datum und Summe werden zusätzlich direkt im Belegtext gesucht. Passt etwas nicht, wird der Beleg trotzdem abgelegt, aber als **„Prüfen“** markiert.

## Voraussetzungen

| | Minimum | Empfohlen |
|---|---|---|
| Rechner | Mini-PC, alter Laptop, NAS mit Docker | Mini-PC mit 4+ Kernen |
| Arbeitsspeicher | **8 GB** | 16 GB |
| Speicher | 10 GB frei (davon ~2 GB KI-Modell) | SSD |
| Software | Linux mit Docker + Docker Compose | – |

Ein Raspberry Pi 5 (8 GB) sollte grundsätzlich auch funktionieren (ungetestet), ist aber deutlich langsamer.

**Dauer pro Beleg** (nur CPU, 4 Kerne, Modell `qwen2.5:3b`): ca. **30–60 Sekunden**. Das passiert im Hintergrund – du musst nicht warten.

## Installation

### 1. Docker installieren (falls noch nicht vorhanden)

Auf einem Debian/Ubuntu-Server:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # danach einmal ab- und wieder anmelden
```

### 2. Projekt herunterladen

```bash
git clone https://github.com/bastio89/kassenbeleg.git
cd kassenbeleg
```

### 3. Konfiguration anlegen

```bash
cp .env.example .env
nano .env
```

Mindestens ändern:

- `POSTGRES_PASSWORD` – ein beliebiges Passwort (**nur Buchstaben und Zahlen**)
- `APP_URL` – die Adresse, unter der du die App später aufrufst (siehe Tailscale unten), z. B. `https://homeserver.tail1234.ts.net`

Alles andere kann zunächst so bleiben. Telegram richtest du später ein.

### 4. Starten

```bash
docker compose up -d --build
```

Beim **ersten Start** lädt der Worker das KI-Modell herunter (~2 GB). Fortschritt ansehen:

```bash
docker compose logs -f worker
```

Wenn `Modell "qwen2.5:3b" ist bereit.` erscheint, ist alles fertig. Die App läuft jetzt unter **http://&lt;IP-des-Servers&gt;:3000**.

Unter **Einstellungen** in der App siehst du, ob KI und Modell bereit sind.

## Zugriff vom Handy – sicher mit Tailscale

Die App hat bewusst **keinen Login**. Damit trotzdem niemand Fremdes an eure Belege kommt, darf sie **nicht offen im Internet** stehen. Im Heimnetz (WLAN) funktioniert sie sofort. Für den Zugriff **von unterwegs** empfehle ich **Tailscale**:

- kostenlos für private Nutzung
- nur eure eigenen Geräte können die App erreichen
- keine Portfreigabe am Router, kein Reverse Proxy, keine Zertifikate nötig

### Einrichtung (ca. 10 Minuten)

1. Konto anlegen auf [tailscale.com](https://tailscale.com) (z. B. mit Google-/Apple-Konto).
2. **Auf dem Server** installieren und anmelden:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   Den angezeigten Link öffnen und den Server freigeben.
3. **HTTPS aktivieren** (nötig, damit sich die App auf Android installieren lässt):
   Im [Tailscale-Admin → DNS](https://login.tailscale.com/admin/dns) „MagicDNS“ und „HTTPS Certificates“ einschalten. Dann auf dem Server:
   ```bash
   sudo tailscale serve --bg 3000
   ```
   Die App ist jetzt unter `https://<servername>.<tailnet>.ts.net` erreichbar – **nur** für Geräte in eurem Tailscale-Netz. Diese Adresse in `.env` bei `APP_URL` eintragen und `docker compose up -d` ausführen.
4. **Auf beiden Handys** die Tailscale-App installieren (App Store / Play Store) und mit **demselben Konto** anmelden. Deine Frau kannst du alternativ unter *Admin → Users → Invite* einladen.
5. Adresse im Handy-Browser öffnen und **als App installieren**:
   - **iPhone:** Safari → Teilen-Symbol → „Zum Home-Bildschirm“
   - **Android:** Chrome → Menü ⋮ → „App installieren“ – danach erscheint „Kassenbelege“ auch im **Teilen-Menü** (Galerie, Mail-Anhänge, Dateimanager)

> **Alternative Reverse Proxy:** Wenn du die App doch über einen eigenen Reverse Proxy (z. B. Caddy, Nginx Proxy Manager) ins Internet stellen willst, setze **unbedingt** `BASIC_AUTH_USER` und `BASIC_AUTH_PASSWORD` in der `.env`. Dann fragt der Browser nach einem Passwort. Den Telegram-Bot betrifft das nicht – er braucht keine offene Portfreigabe.

## Telegram-Bot einrichten

Mit dem Bot könnt ihr Belege einfach **per Telegram schicken**, Belege **suchen** und das **Original zurückbekommen** – praktisch im Laden bei einer Reklamation.

1. In Telegram **@BotFather** öffnen → `/newbot` → Namen vergeben → den **Token** kopieren.
2. Token in `.env` bei `TELEGRAM_BOT_TOKEN` eintragen, dann `docker compose up -d`.
3. Deinem neuen Bot `/id` schreiben – er antwortet mit deiner Telegram-ID. Deine Frau macht dasselbe.
4. Beide IDs kommagetrennt in `.env` eintragen: `TELEGRAM_ALLOWED_USER_IDS=123456789,987654321`, dann `docker compose up -d`.

Nur diese IDs dürfen den Bot benutzen – alle anderen werden abgewiesen.

| Befehl | Funktion |
|---|---|
| Foto oder PDF senden | Beleg erfassen (Antwort mit Zusammenfassung, sobald ausgewertet) |
| `/suche Waschmaschine` oder einfach `Waschmaschine` | Belege finden, Original per Knopfdruck |
| `/letzte` | Letzte Belege |
| `/monat` | Ausgaben im aktuellen Monat nach Kategorie |
| `/garantie` | In den nächsten 90 Tagen ablaufende Garantien |

💡 **Tipp:** Fotos **„als Datei“** senden (Büroklammer → Datei), dann komprimiert Telegram das Bild nicht und die Texterkennung wird besser.

🛡️ **Garantie-Erinnerung:** 30 Tage vor Ablauf (einstellbar über `WARRANTY_REMINDER_DAYS`) schickt der Bot automatisch eine Nachricht.

## KI-Einstellungen & Hardware

Alle Einstellungen stehen in `.env`. Nach Änderungen: `docker compose up -d`.

### Lokal (Standard) – keine Daten verlassen das Haus

```env
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:3b
```

| Modell | RAM-Bedarf | Einsatz |
|---|---|---|
| `qwen2.5:1.5b` | ~1,5 GB | sehr schwache Hardware, ungenauer |
| **`qwen2.5:3b`** (Standard) | ~2,5 GB | **gute Wahl für 8 GB RAM** |
| `qwen2.5:7b` | ~5,5 GB | genauer, ab 16 GB RAM |

Ich habe mehrere kleine Modelle getestet (`qwen2.5:3b`, `qwen3:4b`, `gemma3:4b`, `llama3.2:3b`). `qwen2.5:3b` war auf der CPU am schnellsten und hat die meisten Testartikel richtig zugeordnet.

Das Modell wird beim Start automatisch heruntergeladen. Mit NVIDIA-Grafikkarte: den `deploy`-Block beim Dienst `ollama` in `docker-compose.yml` auskommentieren – dann dauert ein Beleg nur wenige Sekunden.

### OpenRouter (Cloud) – schneller und genauer

[OpenRouter](https://openrouter.ai) bietet viele Modelle über eine Schnittstelle an. Das Bild wird dabei direkt an ein Vision-Modell geschickt – das erkennt auch schwierige Fotos sehr gut. Kosten mit dem voreingestellten `google/gemini-2.5-flash`: Bruchteile eines Cents pro Beleg.

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
```

### Kombination: lokal, bei Fehlern Cloud

```env
AI_PROVIDER=ollama
AI_FALLBACK=openrouter
OPENROUTER_API_KEY=sk-or-...
```

### Vision-Modell lokal (nur mit viel RAM)

```env
AI_MODE=vision
OLLAMA_VISION_MODEL=qwen2.5vl:3b
```

Das Modell „sieht“ dann das Foto selbst. Braucht deutlich mehr RAM und Rechenzeit – für 8-GB-Rechner nicht empfohlen.

## Bedienung

- **Übersicht:** Beleg fotografieren oder hochladen, Ausgaben des Monats, bald ablaufende Garantien, zuletzt erfasste Belege.
- **Belege:** Suche (z. B. „Waschmaschine“, „MediaMarkt“, „Seriennummer“), Filter nach Kategorie und Zeitraum, „Nur zu prüfende“.
- **Beleg-Detail:**
  - Originalfoto/PDF ansehen und **herunterladen**
  - Kategorie eines Artikels über die Auswahl ändern → wird **gelernt**
  - „bearbeiten“: Name, Preis, **Garantie in Monaten** (z. B. 36 bei Herstellergarantie), **Notiz** (z. B. Seriennummer)
  - Belegdaten korrigieren, neu auswerten, löschen
- **Auswertung:** Monat, Jahr, 12 Monate oder freier Zeitraum; CSV-Export für Excel.
- **Garantie:** läuft bald ab / aktiv / abgelaufen, jeweils mit Download des Belegs.
- **Einstellungen → Kategorien:** Kategorien und Unterkategorien anlegen, umbenennen, löschen (Artikel werden verschoben), Standard-Garantie je Kategorie, gelernte Zuordnungen verwalten.

### Doppelte Belege

Wird derselbe Bon zweimal erfasst (z. B. von dir per Telegram und von deiner Frau in der Web-App), erkennt die App das am Inhalt: gleiches Datum, gleicher Betrag, ähnlicher Geschäftsname und – falls erkannt – dieselbe Uhrzeit (±2 Minuten), sonst gleiche Artikelanzahl. Das zweite Exemplar wird **nicht gelöscht**, sondern als „Duplikat“ markiert und in Auswertungen und Garantien nicht mitgezählt. Auf der Belegseite bzw. per Telegram-Button entscheidest du: „Duplikat löschen“ oder „Kein Duplikat – mitzählen“ (z. B. zweimal derselbe Kaffee am selben Tag ohne erkennbare Uhrzeit).

### Garantie-Logik

Für Kategorien mit „Garantie (Monate)“ > 0 bekommt jeder Artikel automatisch eine Garantie ab Kaufdatum. Voreingestellt sind **24 Monate** (gesetzliche Gewährleistung) für Elektronik, Haushaltsgeräte, Möbel, Werkzeug, Fahrrad, Optiker und Sport. Lebensmittel, Drogerie usw. werden nicht verfolgt. Beides lässt sich pro Kategorie und pro Artikel ändern.

## Backup & Wiederherstellung

Alle Daten liegen im Projektordner:

| Ordner | Inhalt |
|---|---|
| `data/files/` | **Originalbelege** (Fotos/PDFs, nach Jahr/Monat sortiert) |
| `data/postgres/` | Datenbank |
| `data/ollama/` | KI-Modell (kann neu geladen werden) |
| `backups/` | tägliche Datenbank-Sicherung (14 Tage) |

**Sichern:** die Ordner `data/files/` und `backups/` regelmäßig auf ein anderes Gerät kopieren (z. B. NAS, externe Platte, Cloud).

**Wiederherstellen** auf einem neuen Server:

```bash
# Projekt klonen, .env zurückkopieren, data/files zurückkopieren, dann:
docker compose up -d db
gunzip -c backups/kassenbeleg-JJJJ-MM-TT.sql.gz | docker compose exec -T db psql -U kassenbeleg kassenbeleg
docker compose up -d
```

## Update

```bash
cd kassenbeleg
git pull
docker compose up -d --build
```

Datenbank-Änderungen werden beim Start automatisch eingespielt.

## Fehlersuche

| Problem | Lösung |
|---|---|
| Beleg bleibt auf „Wartet“ | `docker compose logs -f worker` – lädt das Modell noch? |
| „Ollama nicht erreichbar“ | `docker compose ps` – läuft der Dienst `ollama`? `docker compose restart ollama worker` |
| Beleg „fehlgeschlagen“ | Detailseite → „Erneut versuchen“. Das Original bleibt gespeichert und über den erkannten Text durchsuchbar. |
| Artikel/Summe falsch | Foto gerade, hell und scharf aufnehmen; ganzer Bon im Bild. Oder `AI_FALLBACK=openrouter` setzen. |
| Rechner wird sehr langsam | kleineres Modell (`qwen2.5:1.5b`) oder OpenRouter nutzen |
| Telegram: „Kein Zugriff“ | eigene ID (`/id`) in `TELEGRAM_ALLOWED_USER_IDS` eintragen, `docker compose up -d` |
| App lässt sich auf Android nicht installieren | HTTPS nötig → `tailscale serve` (siehe oben) |

Logs aller Dienste: `docker compose logs -f`

## Technik & Entwicklung

- **Next.js 16** (App Router, TypeScript) – Weboberfläche, API, Server Actions
- **PostgreSQL 16** – Belege, Positionen, Kategorien, gelernte Regeln (Suche mit `pg_trgm`)
- **Worker** (Node.js) – Verarbeitungswarteschlange in der Datenbank (`FOR UPDATE SKIP LOCKED`, sofortiges Aufwecken per `LISTEN/NOTIFY`), Telegram-Bot (grammY), Garantie-Erinnerungen
- **Tesseract** + **Poppler** + **libheif** – Texterkennung, PDF-Verarbeitung und iPhone-Fotos (HEIC), lokal
- **Ollama** / **OpenRouter** – Sprachmodelle mit Structured Outputs (JSON-Schema)

```
src/
  app/            Seiten, API-Routen, Server Actions
  components/     UI-Bausteine
  lib/            Datenbank, KI, OCR, Auswertungen
  worker/         Hintergrund-Verarbeitung & Telegram-Bot
migrations/       SQL-Schema und Standard-Kategorien
```

Lokal entwickeln (PostgreSQL, Tesseract, Poppler, libheif-examples und Ollama installiert):

```bash
npm install
cp .env.example .env.local   # DATABASE_URL, OLLAMA_URL=http://localhost:11434, DATA_DIR=./data
npm run migrate
npm run dev        # Web-App auf http://localhost:3000
npm run worker     # Verarbeitung + Telegram
npm test           # Unit-Tests
```

`src/scripts/eval-categories.ts` misst, wie gut ein Modell Artikel kategorisiert:
`OLLAMA_MODEL=qwen2.5:3b npx tsx src/scripts/eval-categories.ts`
