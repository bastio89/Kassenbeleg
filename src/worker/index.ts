import type { Bot } from "grammy";
import { config, effectiveMode } from "../lib/config";
import { sql } from "../lib/db";
import { migrate } from "../lib/migrate";
import { ensureOllamaModel } from "../lib/ai/ollama";
import { processReceipt } from "../lib/processing";
import type { ReceiptRow } from "../lib/receipts";
import { createBot, notifyProcessed, sendWarrantyReminders } from "./telegram";

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

let bot: Bot | null = null;
let wake: (() => void) | null = null;
let stopping = false;

/** Holt den nächsten offenen Beleg (auch hängengebliebene nach einem Absturz). */
async function claimNext(): Promise<ReceiptRow | null> {
  const [row] = await sql<ReceiptRow[]>`
    UPDATE receipts SET status = 'processing', attempts = attempts + 1, processing_started_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM receipts
      WHERE status = 'pending'
         OR (status = 'processing' AND processing_started_at < now() - interval '30 minutes')
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`;
  return row ?? null;
}

async function handle(receipt: ReceiptRow): Promise<void> {
  const started = Date.now();
  log(`Verarbeite Beleg ${receipt.id} (Versuch ${receipt.attempts}) …`);
  try {
    await processReceipt(receipt);
    log(`Beleg ${receipt.id} fertig in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (e) {
    const message = (e as Error).message;
    const final = receipt.attempts >= config.worker.maxAttempts;
    log(`Beleg ${receipt.id} fehlgeschlagen${final ? "" : " – neuer Versuch folgt"}: ${message}`);
    await sql`
      UPDATE receipts SET status = ${final ? "failed" : "pending"}, error = ${message}, updated_at = now()
      WHERE id = ${receipt.id}`;
    if (!final) return;
  }
  if (bot) await notifyProcessed(bot, receipt.id).catch((e) => log("Telegram-Benachrichtigung:", e.message));
}

async function loop(): Promise<void> {
  while (!stopping) {
    let receipt: ReceiptRow | null = null;
    try {
      receipt = await claimNext();
    } catch (e) {
      log("Datenbankfehler:", (e as Error).message);
    }
    if (receipt) {
      await handle(receipt);
      continue;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, config.worker.pollIntervalMs * 6);
    });
    wake = null;
  }
}

async function prepareModels(): Promise<void> {
  if (config.ai.provider !== "ollama" || !config.ai.ollama.autoPull) return;
  const models = [config.ai.ollama.model];
  if (effectiveMode("ollama") === "vision") models.push(config.ai.ollama.visionModel);
  for (const model of models) {
    // Ollama startet evtl. langsamer als der Worker – mehrfach versuchen
    for (let attempt = 1; ; attempt++) {
      try {
        await ensureOllamaModel(model, log);
        break;
      } catch (e) {
        if (attempt >= 30) {
          log(`Modell ${model} nicht verfügbar:`, (e as Error).message);
          break;
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }
}

async function main(): Promise<void> {
  log("Kassenbeleg-Worker startet …");
  const applied = await migrate(sql);
  if (applied.length) log("Migrationen angewendet:", applied.join(", "));

  log(`KI: ${config.ai.provider} (${effectiveMode(config.ai.provider)})${config.ai.fallback ? `, Fallback: ${config.ai.fallback}` : ""}`);

  bot = createBot();
  if (bot) {
    await bot.api.setMyCommands([
      { command: "suche", description: "Belege durchsuchen" },
      { command: "letzte", description: "Letzte Belege" },
      { command: "monat", description: "Ausgaben im aktuellen Monat" },
      { command: "garantie", description: "Bald ablaufende Garantien" },
      { command: "hilfe", description: "Hilfe" },
    ]).catch((e) => log("Telegram-Befehle:", e.message));
    bot.start({ drop_pending_updates: false, onStart: (me) => log(`Telegram-Bot @${me.username} läuft`) }).catch((e) =>
      log("Telegram-Bot konnte nicht starten:", e.message),
    );
    if (!config.telegram.allowedUserIds.length) {
      log("⚠️ TELEGRAM_ALLOWED_USER_IDS ist leer – der Bot nimmt keine Belege an. Schreib dem Bot /id und trag die ID ein.");
    }
    const remind = () => sendWarrantyReminders(bot!).catch((e) => log("Garantie-Erinnerung:", e.message));
    setTimeout(remind, 60_000);
    setInterval(remind, 6 * 3600 * 1000);
  } else {
    log("Kein TELEGRAM_BOT_TOKEN gesetzt – Telegram-Bot deaktiviert.");
  }

  await sql.listen("receipts_new", () => wake?.());
  await prepareModels();
  await loop();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log("Beende Worker …");
    stopping = true;
    wake?.();
    await bot?.stop().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
