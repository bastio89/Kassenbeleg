// Zentrale Konfiguration aus Umgebungsvariablen (siehe .env.example)

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const n = Number.parseInt(env(name), 10);
  return Number.isFinite(n) ? n : fallback;
}

export type AiProvider = "ollama" | "openrouter";
export type AiMode = "ocr" | "vision";

export const config = {
  databaseUrl: env("DATABASE_URL", "postgres://kassenbeleg:kassenbeleg@localhost:5432/kassenbeleg"),
  dataDir: env("DATA_DIR", "./data"),
  // Hier schreibt der Backup-Dienst seine status.json hin
  backupDir: env("BACKUP_DIR", "./backups"),
  appUrl: env("APP_URL").replace(/\/$/, ""),
  timezone: env("TZ", "Europe/Berlin"),

  ai: {
    provider: env("AI_PROVIDER", "ollama") as AiProvider,
    // "ocr": Tesseract liest Text, das Sprachmodell strukturiert ihn (sparsam, ideal für 8 GB RAM)
    // "vision": das Modell bekommt direkt das Bild (braucht ein Vision-Modell)
    mode: env("AI_MODE") as AiMode | "",
    // Fallback-Anbieter, falls der primäre fehlschlägt (z. B. "openrouter"); leer = keiner
    fallback: env("AI_FALLBACK") as AiProvider | "",
    timeoutMs: int("AI_TIMEOUT_SECONDS", 600) * 1000,
    ollama: {
      url: env("OLLAMA_URL", "http://localhost:11434").replace(/\/$/, ""),
      model: env("OLLAMA_MODEL", "qwen2.5:3b"),
      visionModel: env("OLLAMA_VISION_MODEL", "qwen2.5vl:3b"),
      numCtx: int("OLLAMA_NUM_CTX", 6144),
      keepAlive: env("OLLAMA_KEEP_ALIVE", "5m"),
      autoPull: env("OLLAMA_AUTO_PULL", "true") !== "false",
    },
    openrouter: {
      apiKey: env("OPENROUTER_API_KEY"),
      model: env("OPENROUTER_MODEL", "google/gemini-2.5-flash"),
      url: env("OPENROUTER_URL", "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    },
  },

  ocr: {
    languages: env("OCR_LANGUAGES", "deu+eng"),
  },

  telegram: {
    token: env("TELEGRAM_BOT_TOKEN"),
    allowedUserIds: env("TELEGRAM_ALLOWED_USER_IDS")
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  },

  warranty: {
    // Wie viele Tage vor Ablauf soll erinnert werden?
    reminderDays: int("WARRANTY_REMINDER_DAYS", 30),
  },

  // Optionaler Passwortschutz (HTTP Basic Auth), z. B. falls die App doch öffentlich erreichbar ist
  basicAuth: {
    user: env("BASIC_AUTH_USER"),
    password: env("BASIC_AUTH_PASSWORD"),
  },

  worker: {
    pollIntervalMs: int("WORKER_POLL_SECONDS", 5) * 1000,
    maxAttempts: int("WORKER_MAX_ATTEMPTS", 3),
  },
};

export function effectiveMode(provider: AiProvider): AiMode {
  if (config.ai.mode === "ocr" || config.ai.mode === "vision") return config.ai.mode;
  // Standard: lokal sparsam (OCR + Textmodell), Cloud mit Bild
  return provider === "ollama" ? "ocr" : "vision";
}
