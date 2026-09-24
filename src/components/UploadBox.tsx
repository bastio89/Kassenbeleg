"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result = { name: string; ok: boolean; message: string; id?: string };

export function UploadBox() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  async function upload(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const out: Result[] = [];
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body });
        const data = (await res.json()) as { ok: boolean; id?: string; duplicate?: boolean; error?: string };
        out.push({
          name: file.name,
          ok: data.ok,
          id: data.id,
          message: !data.ok ? data.error ?? "Fehler" : data.duplicate ? "schon vorhanden" : "wird ausgewertet",
        });
      } catch {
        out.push({ name: file.name, ok: false, message: "Upload fehlgeschlagen" });
      }
    }
    setResults(out);
    setBusy(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div
      className={`dropzone${drag ? " drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="upload-actions">
        <button className="btn primary" disabled={busy} onClick={() => cameraRef.current?.click()}>
          📷 Foto aufnehmen
        </button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          📄 Datei / PDF
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      <p className="muted small" style={{ margin: "10px 0 0" }}>
        {busy ? "Wird hochgeladen …" : "oder Dateien hierher ziehen · Fotos & PDF-Rechnungen"}
      </p>
      {results.length > 0 && (
        <ul className="small" style={{ textAlign: "left", margin: "10px 0 0", paddingLeft: 18 }}>
          {results.map((r, i) => (
            <li key={i} style={{ color: r.ok ? undefined : "var(--bad)" }}>
              {r.id ? <a href={`/belege/${r.id}`}>{r.name}</a> : r.name}: {r.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
