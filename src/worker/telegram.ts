import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { config } from "../lib/config";
import { sql } from "../lib/db";
import { dateDe, eur, monthRange, todayIso } from "../lib/format";
import { kpis, listReceipts, spendingByCategory, warranties } from "../lib/queries";
import { markNotDuplicate } from "../lib/duplicates";
import { deleteReceipt } from "../lib/processing";
import { createReceipt } from "../lib/receipts";
import { loadFile } from "../lib/storage";

const HELP = `🧾 *Kassenbeleg-Bot*

Schick mir einfach ein *Foto* oder eine *PDF* eines Belegs – ich lese ihn aus, kategorisiere alle Artikel und lege ihn ab.
💡 Beste Qualität: Foto *als Datei* senden (Büroklammer → Datei), dann komprimiert Telegram nicht.

*Befehle*
/suche <Begriff> – Belege finden (z. B. /suche Waschmaschine)
/letzte – die letzten Belege
/monat – Ausgaben im aktuellen Monat
/garantie – bald ablaufende Garantien
/id – deine Telegram-ID anzeigen

Du kannst auch einfach einen Suchbegriff schreiben.`;

function receiptLink(id: string): string {
  return config.appUrl ? `${config.appUrl}/belege/${id}` : "";
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}

export function createBot(): Bot | null {
  if (!config.telegram.token) return null;
  const bot = new Bot(config.telegram.token);
  const allowed = new Set(config.telegram.allowedUserIds);

  bot.command("id", (ctx) => ctx.reply(`Deine Telegram-ID: ${ctx.from?.id}`));

  // Zugriffsschutz: nur freigegebene Telegram-Konten dürfen den Bot nutzen
  bot.use(async (ctx, next) => {
    const id = String(ctx.from?.id ?? "");
    if (allowed.size > 0 && allowed.has(id)) return next();
    await ctx.reply(
      `⛔ Kein Zugriff.\n\nDeine Telegram-ID ist ${id}. Trage sie in der .env unter TELEGRAM_ALLOWED_USER_IDS ein und starte die App neu.`,
    );
  });

  bot.command(["start", "hilfe", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "Markdown" }));

  const handleUpload = async (ctx: Context, fileId: string, filename: string | undefined, mime: string | undefined) => {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) throw new Error("Datei konnte nicht geladen werden");
    const res = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    const who = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username;
    const result = await createReceipt({
      data,
      filename,
      declaredMime: mime,
      source: "telegram",
      uploadedBy: who ?? null,
      telegramChatId: ctx.chat?.id,
      telegramMessageId: ctx.message?.message_id,
    });
    if (!result.ok) return ctx.reply(`❌ ${result.error}`);
    if (result.duplicate) {
      const link = receiptLink(result.id);
      return ctx.reply(`ℹ️ Diesen Beleg habe ich schon.${link ? `\n${link}` : ""}`, {
        reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
      });
    }
    await ctx.reply("📥 Beleg empfangen – wird ausgewertet …", {
      reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
    });
  };

  bot.on("message:photo", async (ctx) => {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await handleUpload(ctx, photo.file_id, `telegram-${ctx.message.message_id}.jpg`, "image/jpeg");
  });

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
      return ctx.reply("❌ Telegram-Bots können nur Dateien bis 20 MB laden. Bitte über die Web-App hochladen.");
    }
    await handleUpload(ctx, doc.file_id, doc.file_name, doc.mime_type);
  });

  const search = async (ctx: Context, q: string) => {
    if (!q.trim()) return ctx.reply("Wonach soll ich suchen? Beispiel: /suche Waschmaschine");
    const { rows, total } = await listReceipts({ q, limit: 8 });
    if (!rows.length) return ctx.reply(`🔍 Nichts gefunden für „${q}“.`);
    const kb = new InlineKeyboard();
    const lines = rows.map((r, i) => {
      kb.text(`📎 ${i + 1}. ${(r.merchant ?? "Beleg").slice(0, 20)} ${dateDe(r.effective_date)}`, `file:${r.id}`).row();
      const hits = r.matched_items?.length ? `\n   ↳ ${r.matched_items.slice(0, 3).join(", ")}` : "";
      return `${i + 1}. ${dateDe(r.effective_date)} · ${r.merchant ?? "Unbekannt"} · ${eur(r.total, r.currency)}${hits}`;
    });
    await ctx.reply(`🔍 ${total} Treffer für „${q}“:\n\n${lines.join("\n")}\n\nTippe auf einen Eintrag für das Original.`, {
      reply_markup: kb,
    });
  };

  bot.command(["suche", "search"], (ctx) => search(ctx, ctx.match));

  bot.command("letzte", async (ctx) => {
    const { rows } = await listReceipts({ limit: 8 });
    if (!rows.length) return ctx.reply("Noch keine Belege vorhanden.");
    const kb = new InlineKeyboard();
    const lines = rows.map((r, i) => {
      kb.text(`📎 ${i + 1}. ${(r.merchant ?? "Beleg").slice(0, 20)}`, `file:${r.id}`).row();
      const state = r.status === "done" ? "" : r.status === "failed" ? " ⚠️" : " ⏳";
      return `${i + 1}. ${dateDe(r.effective_date)} · ${r.merchant ?? "…"} · ${eur(r.total, r.currency)}${state}`;
    });
    await ctx.reply(lines.join("\n"), { reply_markup: kb });
  });

  bot.command("monat", async (ctx) => {
    const range = monthRange(todayIso().slice(0, 7));
    const [k, cats] = await Promise.all([kpis(range), spendingByCategory(range)]);
    const lines = cats.slice(0, 10).map((c) => `${c.icon ?? "•"} ${c.name}: ${eur(c.total)}`);
    await ctx.reply(
      `📊 Ausgaben ${dateDe(range.from)} – heute\n\n*${eur(k.total)}* in ${k.receipts} Belegen\n\n${lines.map(escapeMd).join("\n")}`,
      { parse_mode: "Markdown" },
    );
  });

  bot.command("garantie", async (ctx) => {
    const rows = await warranties("expiring", 90);
    const active = await warranties("active");
    if (!rows.length) return ctx.reply(`✅ Keine Garantie läuft in den nächsten 90 Tagen ab. (${active.length} aktiv)`);
    const kb = new InlineKeyboard();
    const lines = rows.slice(0, 10).map((w, i) => {
      kb.text(`📎 ${i + 1}. ${w.name.slice(0, 25)}`, `file:${w.receipt_id}`).row();
      return `${i + 1}. ${w.name} (${w.merchant ?? "?"}) – bis ${dateDe(w.warranty_until)}, noch ${w.days_left} Tage`;
    });
    await ctx.reply(`🛡️ Bald ablaufende Garantien:\n\n${lines.join("\n")}`, { reply_markup: kb });
  });

  bot.callbackQuery(/^file:([0-9a-f-]{36})$/, async (ctx) => {
    const id = ctx.match[1];
    const [r] = await sql<{ file_path: string; original_filename: string | null; mime_type: string; merchant: string | null; purchase_date: string | null; total: string | null }[]>`
      SELECT file_path, original_filename, mime_type, merchant, purchase_date::text, total::text FROM receipts WHERE id = ${id}`;
    await ctx.answerCallbackQuery();
    if (!r) return ctx.reply("Beleg nicht gefunden.");
    const data = await loadFile(r.file_path);
    const ext = r.file_path.split(".").pop();
    const name = r.original_filename ?? `beleg-${r.purchase_date ?? id}.${ext}`;
    const caption = [`${r.merchant ?? "Beleg"} · ${dateDe(r.purchase_date)} · ${eur(r.total)}`, receiptLink(id)]
      .filter(Boolean)
      .join("\n");
    await ctx.replyWithDocument(new InputFile(data, name), { caption });
  });

  bot.callbackQuery(/^dup_(del|keep):([0-9a-f-]{36})$/, async (ctx) => {
    const [, action, id] = ctx.match;
    if (action === "del") {
      await deleteReceipt(id);
      await ctx.answerCallbackQuery({ text: "Duplikat gelöscht" });
      await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n🗑️ Duplikat gelöscht.`).catch(() => {});
    } else {
      await markNotDuplicate(id);
      await ctx.answerCallbackQuery({ text: "Wird mitgezählt" });
      await ctx.editMessageText(`${ctx.callbackQuery.message?.text ?? ""}\n\n✅ Kein Duplikat – wird mitgezählt.`).catch(() => {});
    }
  });

  bot.on("message:text", (ctx) => {
    if (ctx.message.text.startsWith("/")) return ctx.reply(HELP, { parse_mode: "Markdown" });
    return search(ctx, ctx.message.text);
  });

  bot.catch((err) => {
    console.error("[telegram] Fehler:", err.error);
    err.ctx.reply("❌ Da ist etwas schiefgelaufen. Bitte später erneut versuchen.").catch(() => {});
  });

  return bot;
}

/** Nachricht nach der Verarbeitung an den Chat, aus dem der Beleg kam. */
export async function notifyProcessed(bot: Bot, receiptId: string): Promise<void> {
  const [r] = await sql<
    { status: string; merchant: string | null; purchase_date: string | null; total: string | null; currency: string;
      error: string | null; needs_review: boolean; review_reason: string | null; telegram_chat_id: string | null;
      telegram_message_id: number | null; duplicate_of: string | null; original_source: string | null;
      original_created: Date | null }[]
  >`SELECT r.status, r.merchant, r.purchase_date::text, r.total::text, r.currency, r.error, r.needs_review,
           r.review_reason, r.telegram_chat_id::text, r.telegram_message_id, r.duplicate_of,
           o.source AS original_source, o.created_at AS original_created
    FROM receipts r LEFT JOIN receipts o ON o.id = r.duplicate_of
    WHERE r.id = ${receiptId}`;
  if (!r?.telegram_chat_id) return;
  const link = receiptLink(receiptId);
  let text: string;
  if (r.status === "failed") {
    text = `⚠️ Beleg konnte nicht ausgewertet werden:\n${r.error ?? "Unbekannter Fehler"}\n\nDas Original ist gespeichert und über den Text durchsuchbar.`;
  } else {
    const cats = await sql<{ icon: string | null; name: string; total: string; n: number }[]>`
      SELECT root.icon, root.name, sum(i.total_price)::text AS total, count(*)::int AS n
      FROM receipt_items i
      JOIN categories c ON c.id = i.category_id
      JOIN categories root ON root.id = COALESCE(c.parent_id, c.id)
      WHERE i.receipt_id = ${receiptId}
      GROUP BY root.icon, root.name ORDER BY sum(i.total_price) DESC`;
    const [{ w }] = await sql<{ w: number }[]>`
      SELECT count(*)::int AS w FROM receipt_items WHERE receipt_id = ${receiptId} AND warranty_months > 0`;
    const count = cats.reduce((s, c) => s + c.n, 0);
    text =
      `✅ ${r.merchant ?? "Beleg"} · ${dateDe(r.purchase_date)} · ${eur(r.total, r.currency)}\n` +
      `${count} Artikel\n\n` +
      cats.map((c) => `${c.icon ?? "•"} ${c.name}: ${eur(c.total, r.currency)}`).join("\n") +
      (w ? `\n\n🛡️ ${w} Artikel mit Garantie erfasst` : "") +
      (r.needs_review ? `\n\n⚠️ Bitte prüfen: ${r.review_reason}` : "");
  }
  let keyboard: InlineKeyboard | undefined;
  if (r.status !== "failed" && r.duplicate_of) {
    const when = r.original_created?.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
    text =
      `♊ Diesen Bon habe ich schon: ${r.merchant ?? "Beleg"} · ${dateDe(r.purchase_date)} · ${eur(r.total, r.currency)}` +
      `\n(erfasst am ${when}${r.original_source === "telegram" ? " per Telegram" : ""})` +
      `\n\nDas zweite Exemplar wird nicht doppelt gezählt.`;
    keyboard = new InlineKeyboard()
      .text("🗑️ Duplikat löschen", `dup_del:${receiptId}`)
      .text("Kein Duplikat", `dup_keep:${receiptId}`);
  }
  if (link) text += `\n\n${link}`;
  await bot.api.sendMessage(r.telegram_chat_id, text, {
    reply_markup: keyboard,
    reply_parameters: r.telegram_message_id
      ? { message_id: r.telegram_message_id, allow_sending_without_reply: true }
      : undefined,
  });
}

/** Erinnert an bald ablaufende Garantien (einmal pro Artikel). */
export async function sendWarrantyReminders(bot: Bot): Promise<void> {
  const chats = config.telegram.allowedUserIds;
  if (!chats.length) return;
  const due = await sql<{ item_id: number; receipt_id: string; name: string; merchant: string | null; warranty_until: string; days_left: number }[]>`
    SELECT item_id, receipt_id, name, merchant, warranty_until::text, (warranty_until - current_date)::int AS days_left
    FROM warranty_items
    WHERE warranty_notified_at IS NULL
      AND warranty_until BETWEEN current_date AND current_date + ${config.warranty.reminderDays}::int
    ORDER BY warranty_until`;
  if (!due.length) return;
  const kb = new InlineKeyboard();
  due.slice(0, 10).forEach((d, i) => kb.text(`📎 ${i + 1}. ${d.name.slice(0, 25)}`, `file:${d.receipt_id}`).row());
  const text =
    `🛡️ Garantie läuft bald ab:\n\n` +
    due.map((d, i) => `${i + 1}. ${d.name} (${d.merchant ?? "?"}) – bis ${dateDe(d.warranty_until)}, noch ${d.days_left} Tage`).join("\n") +
    `\n\nFunktioniert noch alles? Jetzt ist die Zeit für Reklamationen.`;
  for (const chat of chats) {
    await bot.api.sendMessage(chat, text, { reply_markup: kb }).catch((e) => console.warn("[telegram] Erinnerung:", e.message));
  }
  await sql`UPDATE receipt_items SET warranty_notified_at = now() WHERE id = ANY(${due.map((d) => d.item_id)})`;
}
