import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./exec";

/** Eingebetteter Text einer PDF (digitale Rechnungen). Leer bei eingescannten PDFs. */
export async function pdfText(pdf: Buffer): Promise<string> {
  const out = await run("pdftotext", ["-layout", "-l", "5", "-", "-"], pdf);
  return out.toString("utf8").replace(/\f/g, "\n").trim();
}

/** Rendert die ersten Seiten einer PDF als PNG. */
export async function pdfToImages(pdf: Buffer, maxPages = 3, dpi = 200): Promise<Buffer[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "beleg-"));
  try {
    const src = path.join(dir, "in.pdf");
    await writeFile(src, pdf);
    await run("pdftoppm", ["-r", String(dpi), "-png", "-f", "1", "-l", String(maxPages), src, path.join(dir, "page")]);
    const files = (await readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();
    return Promise.all(files.map((f) => readFile(path.join(dir, f))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
