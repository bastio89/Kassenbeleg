"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Übersicht", icon: "🏠" },
  { href: "/belege", label: "Belege", icon: "🧾" },
  { href: "/auswertung", label: "Auswertung", icon: "📊" },
  { href: "/garantie", label: "Garantie", icon: "🛡️" },
  { href: "/einstellungen", label: "Mehr", icon: "⚙️" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/einstellungen" && pathname.startsWith("/kategorien"));
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={isActive(pathname, l.href) ? "active" : undefined}>
          {l.label === "Mehr" ? "Einstellungen" : l.label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottomnav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={isActive(pathname, l.href) ? "active" : undefined}>
          <span aria-hidden>{l.icon}</span>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
