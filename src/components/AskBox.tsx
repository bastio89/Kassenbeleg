"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { askAction, type AskState } from "@/app/ask-actions";

const EXAMPLES = [
  "Wie viel haben wir dieses Jahr für Kaffee ausgegeben?",
  "Wofür geben wir am meisten aus?",
  "Wie oft waren wir letzten Monat bei Lidl?",
  "Wann haben wir den Fernseher gekauft?",
  "Wie viel geben wir im Schnitt pro Monat für Restaurants aus?",
];

export function AskBox() {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, {});
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const a = state.answer;

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <h2 style={{ margin: 0 }}>💬 Frag deine Ausgaben</h2>
      <form ref={formRef} action={action} className="row">
        <input
          ref={inputRef}
          name="question"
          defaultValue={state.question ?? ""}
          placeholder="z. B. Wie viel haben wir im August für Essen gezahlt?"
          style={{ flex: 1, minWidth: 220 }}
          maxLength={500}
          required
        />
        <button className="btn primary" disabled={pending}>
          {pending ? "Denke nach …" : "Fragen"}
        </button>
      </form>
      {!a && !state.error && !pending && (
        <div className="row small">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              className="badge"
              style={{ cursor: "pointer", border: "none", font: "inherit", fontSize: 12 }}
              onClick={() => {
                if (inputRef.current) inputRef.current.value = q;
                formRef.current?.requestSubmit();
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {pending && <p className="muted small" style={{ margin: 0 }}>Die lokale KI liest die Frage – das dauert etwa 5–20 Sekunden …</p>}
      {state.error && !pending && <div className="alert bad">{state.error}</div>}
      {a && !pending && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{a.headline}</p>
          {a.lines.length > 0 && (
            <table>
              <tbody>
                {a.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.receiptId ? <Link href={`/belege/${l.receiptId}`}>{l.text}</Link> : l.text}</td>
                    <td className="right num">{l.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            🧠 Verstanden als: {a.understood} · {a.model}, {a.seconds.toLocaleString("de-DE")} s
          </p>
        </div>
      )}
    </section>
  );
}
