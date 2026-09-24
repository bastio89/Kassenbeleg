"use server";

import { ask, type Answer } from "@/lib/ask";

export type AskState = { answer?: Answer; error?: string; question?: string };

export async function askAction(_prev: AskState, fd: FormData): Promise<AskState> {
  const question = String(fd.get("question") ?? "").trim();
  if (question.length < 3) return { error: "Bitte eine Frage eingeben." };
  try {
    return { answer: await ask(question.slice(0, 500)), question };
  } catch (e) {
    console.error("[frage]", e);
    return { question, error: `Die KI konnte die Frage gerade nicht beantworten (${(e as Error).message.slice(0, 200)}).` };
  }
}
