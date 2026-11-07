import { render } from "preact"
import { signal, effect } from "@preact/signals"
import "../shared/style.css"
import { exchange, markPaint, readFragment, saveAnswer } from "../shared/api"
import { t } from "../shared/messages"
import type { Exchange } from "../shared/schema"

const { token, v } = readFragment()
const data = signal<Exchange | null>(null)
const screen = signal(1)
const q1 = signal(v)
const q2 = signal(0)
const lead = signal("")
const err = signal("")
const fail = () => (err.value = t("error"))

exchange(token).then((d) => (data.value = d), fail)
effect(() => { if (data.value) markPaint("meaningful") })

const Scale = ({ name, value, onPick }: { name: string; value: number; onPick: (n: number) => void }) => (
  <div class="scale">
    {[1, 2, 3, 4, 5].map((n) => (
      <label>
        <input type="radio" name={name} value={n} checked={value === n} onChange={() => onPick(n)} />
        {t(`scale.${n}` as "scale.1")}
      </label>
    ))}
  </div>
)


const App = () => {
  const d = data.value
  const s = screen.value
  return (
    <main>
      <h1 id="pulse">{d?.pulseName}</h1>
      <p class="err" role="alert">{err.value}</p>
      {s === 1 && (
        <form onSubmit={async (e) => {
          e.preventDefault()
          try {
            await saveAnswer(token, d!.questions[0].id, { value: q1.value })
            screen.value = 2
            markPaint("screen2")
          } catch { fail() }
        }}>
          <fieldset>
            <legend tabIndex={-1}>{d ? d.questions[0].text : t("loading")}</legend>
            <Scale name="q1" value={q1.value} onPick={(n) => (q1.value = n)} />
          </fieldset>
          <p class="anon">{d?.anonymity}</p>
          <button type="submit" disabled={!d}>{t("save")}</button>
        </form>
      )}
      {s === 2 && d && (
        <section>
          <fieldset>
            <legend tabIndex={-1} ref={(el) => el?.focus()}>{d.questions[1].text}</legend>
            <Scale name="q2" value={q2.value} onPick={(n) => { q2.value = n; saveAnswer(token, d.questions[1].id, { value: n }).catch(fail) }} />
          </fieldset>
          <label for="comment"><b>{t("comment.label")}</b></label>
          <p class="lead" id="hint">{t("comment.hint")}</p>
          <textarea id="comment" aria-describedby="hint" onChange={async (e) => {
            try {
              const r = await saveAnswer(token, d.questions[1].id, { comment: (e.target as HTMLTextAreaElement).value })
              lead.value = t("comment.leadSees", { text: r.shownToLead ?? "" })
            } catch { fail() }
          }} />
          <p class="lead" aria-live="polite">{lead.value}</p>
          <button type="button" onClick={() => (screen.value = 3)}>{t("next")}</button>
        </section>
      )}
      {s === 3 && d && (
        <section>
          <h2 tabIndex={-1} ref={(el) => el?.focus()}>{t("thanks.title")}</h2>
          <p>{t("thanks.body")}</p>
          <ul class="actions">{d.actions.map((a) => <li>{a.title}</li>)}</ul>
        </section>
      )}
    </main>
  )
}
render(<App />, document.getElementById("app")!)
