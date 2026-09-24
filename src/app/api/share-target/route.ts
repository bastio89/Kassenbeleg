import { createReceipt } from "@/lib/receipts";

// Android: "Teilen → Kassenbelege" aus Galerie, Dateimanager oder Mail-App
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  let lastId: string | undefined;
  for (const file of files) {
    const result = await createReceipt({
      data: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      declaredMime: file.type,
      source: "share",
    });
    if (result.ok) lastId = result.id;
  }
  const target = files.length === 1 && lastId ? `/belege/${lastId}` : "/belege";
  return Response.redirect(new URL(target, req.url), 303);
}
