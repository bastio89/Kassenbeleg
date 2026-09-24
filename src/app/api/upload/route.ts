import { createReceipt } from "@/lib/receipts";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "Keine Datei erhalten" }, { status: 400 });
  const result = await createReceipt({
    data: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    declaredMime: file.type,
    source: "web",
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
