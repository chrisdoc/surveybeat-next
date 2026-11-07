import { createRoot } from "react-dom/client"
import { useEffect, useState } from "react"
import "../shared/style.css"
import { exchange, markPaint, readFragment, saveAnswer } from "../shared/api"
import { t } from "../shared/messages"
import type { Exchange } from "../shared/schema"

const { token, v } = readFragment()

const Scale = ({ name, value, onPick }: { name: string; value: number; onPick: (n: number) => void }) => (
  <div className="scale">
    {[1, 2, 3, 4, 5].map((n) => (
      <label key={n}>
        <input type="radio" name={name} value={n} checked={value === n} onChange={() => onPick(n)} />
        {t(`scale.${n}` as "scale.1")}
      </label>
    ))}
  </div>
)

const App = () => {
  const [d, setD] = useState<Exchange | null>(null)
  const [s, setS] = useState(1)
  const [q1, setQ1] = useState(v)
  const [q2, setQ2] = useState(0)
  const [lead, setLead] = useState("")
  const [err, setErr] = useState("")
  const fail = () => setErr(t("error"))
  useEffect(() => { exchange(token).then(setD, fail) }, [])
  useEffect(() => { if (d) markPaint("meaningful") }, [d])
  return (
    <main>
      <h1 id="pulse">{d?.pulseName}</h1>
      <p className="err" role="alert">{err}</p>
      {s === 1 && (
        <form onSubmit={async (e) => {
          e.preventDefault()
          try {
            await saveAnswer(token, d!.questions[0].id, { value: q1 })
            setS(2)
            markPaint("screen2")
          } catch { fail() }
        }}>
          <fieldset>
            <legend tabIndex={-1}>{d ? d.questions[0].text : t("loading")}</legend>
            <Scale name="q1" value={q1} onPick={setQ1} />
          </fieldset>
          <p className="anon">{d?.anonymity}</p>
          <button type="submit" disabled={!d}>{t("save")}</button>
        </form>
      )}
      {s === 2 && d && (
        <section>
          <fieldset>
            <legend tabIndex={-1} ref={(el) => el?.focus()}>{d.questions[1].text}</legend>
            <Scale name="q2" value={q2} onPick={(n) => { setQ2(n); saveAnswer(token, d.questions[1].id, { value: n }).catch(fail) }} />
          </fieldset>
          <label htmlFor="comment"><b>{t("comment.label")}</b></label>
          <p className="lead" id="hint">{t("comment.hint")}</p>
          <textarea id="comment" aria-describedby="hint" onBlur={async (e) => {
            try {
              const r = await saveAnswer(token, d.questions[1].id, { comment: e.target.value })
              setLead(t("comment.leadSees", { text: r.shownToLead ?? "" }))
            } catch { fail() }
          }} />
          <p className="lead" aria-live="polite">{lead}</p>
          <button type="button" onClick={() => setS(3)}>{t("next")}</button>
        </section>
      )}
      {s === 3 && d && (
        <section>
          <h2 tabIndex={-1} ref={(el) => el?.focus()}>{t("thanks.title")}</h2>
          <p>{t("thanks.body")}</p>
          <ul className="actions">{d.actions.map((a) => <li key={a.id}>{a.title}</li>)}</ul>
        </section>
      )}
    </main>
  )
}
createRoot(document.getElementById("app")!).render(<App />)
