import { sql } from "@/lib/db";
import { loadFile } from "@/lib/storage";

export async function GET(req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "preview" ? "preview" : "original";
  const [r] = await sql<
    { file_path: string; preview_path: string | null; mime_type: string; original_filename: string | null;
      merchant: string | null; purchase_date: string | null }[]
  >`SELECT file_path, preview_path, mime_type, original_filename, merchant, purchase_date::text
    FROM receipts WHERE id = ${id}`;
  if (!r) return new Response("Nicht gefunden", { status: 404 });

  const path = type === "preview" && r.preview_path ? r.preview_path : r.file_path;
  const mime = type === "preview" && r.preview_path ? "image/webp" : r.mime_type;
  let data: Buffer;
  try {
    data = await loadFile(path);
  } catch {
    return new Response("Datei fehlt", { status: 404 });
  }
  const ext = r.file_path.split(".").pop();
  const niceName =
    r.original_filename ??
    `Beleg ${r.purchase_date ?? ""} ${r.merchant ?? ""}`.trim().replace(/[^\p{L}\p{N} ._-]/gu, "") + `.${ext}`;
  const disposition = url.searchParams.has("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": mime,
      "content-length": String(data.length),
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(niceName)}`,
      "cache-control": "private, max-age=86400",
    },
  });
}
