import { NextResponse, type NextRequest } from "next/server";

// Optionaler Passwortschutz per HTTP Basic Auth. Nur aktiv, wenn BASIC_AUTH_USER und
// BASIC_AUTH_PASSWORD gesetzt sind – im Heimnetz/Tailscale nicht nötig.
export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.next();
  if (req.nextUrl.pathname === "/api/health") return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const sep = decoded.indexOf(":");
    if (sep !== -1 && decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Anmeldung erforderlich", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Kassenbelege", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|manifest.webmanifest|sw.js).*)"],
};
