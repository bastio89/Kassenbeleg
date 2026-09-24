"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Seite regelmäßig neu, solange noch Belege verarbeitet werden. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
