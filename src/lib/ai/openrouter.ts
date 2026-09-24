import { config } from "../config";
import type { ChatRequest, ChatResult, LlmClient } from "./types";

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

async function call(req: ChatRequest, structured: boolean): Promise<Response> {
  const { apiKey, model, url } = config.ai.openrouter;
  const userContent: Content = req.images?.length
    ? [
        { type: "text", text: req.user },
        ...req.images.map((b) => ({
          type: "image_url" as const,
          image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` },
        })),
      ]
    : req.user;
  return fetch(`${url}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(config.ai.timeoutMs),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-title": "Kassenbeleg",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: userContent },
      ],
      ...(structured
        ? { response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.schema } } }
        : {}),
    }),
  });
}

export const openrouter: LlmClient = {
  provider: "openrouter",
  isConfigured: () => Boolean(config.ai.openrouter.apiKey),
  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!config.ai.openrouter.apiKey) throw new Error("OPENROUTER_API_KEY ist nicht gesetzt");
    let res = await call(req, true);
    // Nicht jedes Modell unterstützt Structured Outputs – dann ohne Schema erneut versuchen
    if (res.status === 400 || res.status === 404) res = await call(req, false);
    if (!res.ok) throw new Error(`OpenRouter-Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    return { content: data.choices?.[0]?.message?.content ?? "", model: data.model ?? config.ai.openrouter.model };
  },
};
