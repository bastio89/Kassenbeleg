import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Nav, BottomNav } from "@/components/Nav";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

// Alle Seiten lesen live aus der Datenbank
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kassenbelege",
  description: "Belege erfassen, Ausgaben verstehen, Garantien im Blick",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Belege", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a19" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="topbar">
          <div className="inner">
            <Link href="/" className="brand">
              <span aria-hidden>🧾</span> Kassenbelege
            </Link>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
        <BottomNav />
        <ServiceWorker />
      </body>
    </html>
  );
}
