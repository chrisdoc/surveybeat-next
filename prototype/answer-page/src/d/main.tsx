import { createRoot } from "react-dom/client"
import { useEffect, useState } from "react"
import { RadioGroup } from "@base-ui/react/radio-group"
import { Radio } from "@base-ui/react/radio"
import { Button } from "@base-ui/react/button"
import { Field } from "@base-ui/react/field"
import { Fieldset } from "@base-ui/react/fieldset"
import "../shared/style.css"
import "./ui.css"
import { exchange, markPaint, readFragment, saveAnswer } from "../shared/api"
import { t } from "../shared/messages"
import type { Exchange } from "../shared/schema"

const { token, v } = readFragment()

const Scale = ({ name, value, onPick }: { name: string; value: number; onPick: (n: number) => void }) => (
  <Field.Root name={name}><RadioGroup name={name} value={value ? String(value) : ""} onValueChange={(x) => onPick(Number(x))} className="scale">
    {[1, 2, 3, 4, 5].map((n) => (
      <Field.Item key={n}>
        <Field.Label className="bu-item">
          <Radio.Root value={String(n)} className="bu-radio"><Radio.Indicator className="bu-dot" /></Radio.Root>
          {t(`scale.${n}` as "scale.1")}
        </Field.Label>
      </Field.Item>
    ))}
  </RadioGroup></Field.Root>
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
          <Fieldset.Root render={<fieldset />}>
            <Fieldset.Legend tabIndex={-1}>{d ? d.questions[0].text : t("loading")}</Fieldset.Legend>
            <Scale name="q1" value={q1} onPick={setQ1} />
          </Fieldset.Root>
          <p className="anon">{d?.anonymity}</p>
          <Button type="submit" disabled={!d} className="bu-btn">{t("save")}</Button>
        </form>
      )}
      {s === 2 && d && (
        <section>
          <Fieldset.Root render={<fieldset />}>
            <Fieldset.Legend tabIndex={-1} ref={(el) => el?.focus()}>{d.questions[1].text}</Fieldset.Legend>
            <Scale name="q2" value={q2} onPick={(n) => { setQ2(n); saveAnswer(token, d.questions[1].id, { value: n }).catch(fail) }} />
          </Fieldset.Root>
          <Field.Root>
            <Field.Label><b>{t("comment.label")}</b></Field.Label>
            <Field.Description className="lead">{t("comment.hint")}</Field.Description>
            <Field.Control render={<textarea />} onBlur={async (e: any) => {
              try {
                const r = await saveAnswer(token, d.questions[1].id, { comment: e.target.value })
                setLead(t("comment.leadSees", { text: r.shownToLead ?? "" }))
              } catch { fail() }
            }} />
          </Field.Root>
          <p className="lead" aria-live="polite">{lead}</p>
          <Button onClick={() => setS(3)} className="bu-btn">{t("next")}</Button>
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
