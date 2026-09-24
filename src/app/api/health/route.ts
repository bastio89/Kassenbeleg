import { sql } from "@/lib/db";

export async function GET() {
  try {
    await sql`SELECT 1`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
