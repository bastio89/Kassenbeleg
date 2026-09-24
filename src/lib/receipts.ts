import { sql } from "./db";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, saveFile, sha256, sniffMime } from "./storage";

export interface ReceiptRow {
  id: string;
  status: "pending" | "processing" | "done" | "failed";
  source: string;
  uploaded_by: string | null;
  original_filename: string | null;
  file_path: string;
  mime_type: string;
  file_size: number;
  preview_path: string | null;
  merchant: string | null;
  merchant_address: string | null;
  purchase_date: string | null;
  purchase_time: string | null;
  total: string | null;
  currency: string;
  payment_method: string | null;
  raw_text: string | null;
  notes: string | null;
  needs_review: boolean;
  review_reason: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  error: string | null;
  attempts: number;
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
  processed_at: Date | null;
  created_at: Date;
}

export interface CreateReceiptInput {
  data: Buffer;
  filename?: string;
  declaredMime?: string;
  source: "web" | "telegram" | "share";
  uploadedBy?: string | null;
  telegramChatId?: number;
  telegramMessageId?: number;
}

export type CreateReceiptResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; error: string };

/** Speichert die Originaldatei und legt einen Beleg zur Verarbeitung an. */
export async function createReceipt(input: CreateReceiptInput): Promise<CreateReceiptResult> {
  if (input.data.length === 0) return { ok: false, error: "Datei ist leer" };
  if (input.data.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Datei ist größer als 25 MB" };
  const mime = sniffMime(input.data, input.declaredMime, input.filename);
  if (!mime) return { ok: false, error: "Nur Fotos (JPG, PNG, WebP, HEIC) und PDF-Dateien werden unterstützt" };

  const hash = sha256(input.data);
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM receipts WHERE sha256 = ${hash}`;
  if (existing) return { ok: true, id: existing.id, duplicate: true };

  const filePath = await saveFile(input.data, ALLOWED_MIME[mime]);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO receipts (source, uploaded_by, original_filename, file_path, mime_type, file_size, sha256,
                          telegram_chat_id, telegram_message_id)
    VALUES (${input.source}, ${input.uploadedBy ?? null}, ${input.filename ?? null}, ${filePath}, ${mime},
            ${input.data.length}, ${hash}, ${input.telegramChatId ?? null}, ${input.telegramMessageId ?? null})
    ON CONFLICT (sha256) DO NOTHING
    RETURNING id`;
  if (!row) {
    const [dupe] = await sql<{ id: string }[]>`SELECT id FROM receipts WHERE sha256 = ${hash}`;
    return { ok: true, id: dupe.id, duplicate: true };
  }
  // Worker sofort aufwecken
  await sql`SELECT pg_notify('receipts_new', ${row.id})`;
  return { ok: true, id: row.id, duplicate: false };
}

export async function requeueReceipt(id: string): Promise<void> {
  await sql`
    UPDATE receipts SET status = 'pending', attempts = 0, error = NULL, updated_at = now()
    WHERE id = ${id} AND status <> 'processing'`;
  await sql`SELECT pg_notify('receipts_new', ${id})`;
}
