import { decodeExchange } from "./decode"
import type { Exchange } from "./schema"

export const mark = (n: string) => performance.mark(n)

export function readFragment() {
  const p = new URLSearchParams(location.hash.slice(1))
  const token = p.get("t") ?? ""
  const v = Math.min(5, Math.max(1, Number(p.get("v")) || 3))
  // ADR 0005: remove the fragment so the token does not linger in history.
  history.replaceState(null, "", location.pathname + location.search)
  return { token, v }
}

const post = async (path: string, body: unknown) => {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

export const exchange = async (token: string): Promise<Exchange> =>
  decodeExchange(await post("/exchange", { token }))

export const saveAnswer = async (
  token: string,
  questionId: string,
  body: { value?: number; comment?: string },
): Promise<{ saved: boolean; shownToLead?: string }> => {
  mark("answer-start")
  const r = await post("/answer", { token, questionId, ...body })
  mark("answer-end")
  return r
}

// Marks when the work has actually been painted (approximation: next frame + task).
export const markPaint = (n: string) =>
  requestAnimationFrame(() => setTimeout(() => mark(n)))
