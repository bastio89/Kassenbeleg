import { config } from "../config";
import type { ChatRequest, ChatResult, LlmClient } from "./types";

/** Liest eine NDJSON-Antwort (eine JSON-Zeile pro Nachricht) von Ollama. */
async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as T;
    }
    if (done) {
      if (buffer.trim()) yield JSON.parse(buffer) as T;
      return;
    }
  }
}

export const ollama: LlmClient = {
  provider: "ollama",
  isConfigured: () => Boolean(config.ai.ollama.url),
  async chat(req: ChatRequest): Promise<ChatResult> {
    const { url, numCtx, keepAlive } = config.ai.ollama;
    const model = req.mode === "vision" && req.images?.length ? config.ai.ollama.visionModel : config.ai.ollama.model;
    // Streaming: Node.js bricht Anfragen ab, wenn 5 Minuten lang keine Antwort-Header kommen.
    // Auf langsamer Hardware (CPU, 8 GB) kann ein Beleg länger dauern – beim Streamen fließen sofort Daten.
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(config.ai.timeoutMs),
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: keepAlive,
        format: req.schema,
        options: { temperature: 0, num_ctx: numCtx },
        messages: [
          { role: "system", content: req.system },
          {
            role: "user",
            content: req.user,
            ...(req.images?.length ? { images: req.images.map((b) => b.toString("base64")) } : {}),
          },
        ],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama-Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`);
    let content = "";
    for await (const part of ndjson<{ message?: { content?: string }; error?: string }>(res.body)) {
      if (part.error) throw new Error(`Ollama: ${part.error}`);
      content += part.message?.content ?? "";
    }
    return { content, model };
  },
};

export interface OllamaStatus {
  reachable: boolean;
  models: string[];
  error?: string;
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${config.ai.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { reachable: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { reachable: true, models: (data.models ?? []).map((m) => m.name) };
  } catch (e) {
    return { reachable: false, models: [], error: (e as Error).message };
  }
}

export function hasModel(models: string[], wanted: string): boolean {
  const full = wanted.includes(":") ? wanted : `${wanted}:latest`;
  return models.includes(full) || models.includes(wanted);
}

/** Lädt ein Modell herunter, falls es fehlt (kann beim ersten Start einige Minuten dauern). */
export async function ensureOllamaModel(model: string, log = console.log): Promise<void> {
  const status = await ollamaStatus();
  if (!status.reachable) throw new Error(`Ollama nicht erreichbar (${status.error})`);
  if (hasModel(status.models, model)) return;
  log(`Lade KI-Modell "${model}" herunter – das dauert beim ersten Start einige Minuten …`);
  const res = await fetch(`${config.ai.ollama.url}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Modell-Download fehlgeschlagen: ${res.status} ${await res.text()}`);
  let lastPercent = -10;
  for await (const p of ndjson<{ total?: number; completed?: number; error?: string }>(res.body)) {
    if (p.error) throw new Error(`Modell-Download fehlgeschlagen: ${p.error}`);
    if (p.total && p.completed) {
      const percent = Math.floor((p.completed / p.total) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        log(`  ${model}: ${percent} %`);
      }
    }
  }
  log(`Modell "${model}" ist bereit.`);
}
