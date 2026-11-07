import { exchange, markPaint, readFragment, saveAnswer } from "../shared/api"
import { t } from "../shared/messages"

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T
const { token, v } = readFragment()
const radio = (name: string, val: number) =>
  document.querySelector<HTMLInputElement>(`input[name=${name}][value="${val}"]`)!
radio("q1", v).checked = true

const show = (n: number) => {
  document.querySelectorAll<HTMLElement>("[data-screen]").forEach((s) => (s.hidden = s.dataset.screen !== String(n)))
  $<HTMLElement>(`[data-screen="${n}"] legend, [data-screen="${n}"] h2`).focus()
}
const fail = () => ($("#err").textContent = t("error"))

exchange(token)
  .then((d) => {
    $("#pulse").textContent = d.pulseName
    $("#q1text").textContent = d.questions[0].text
    $("#q2text").textContent = d.questions[1].text
    $("#anon").textContent = d.anonymity
    $<HTMLButtonElement>("#save").disabled = false
    const ul = $("#actions")
    for (const a of d.actions) {
      const li = document.createElement("li")
      li.textContent = a.title
      ul.append(li)
    }
    markPaint("meaningful")

    $("#f1").addEventListener("submit", async (e) => {
      e.preventDefault()
      const val = Number(document.querySelector<HTMLInputElement>("input[name=q1]:checked")!.value)
      try {
        await saveAnswer(token, d.questions[0].id, { value: val })
        show(2)
        markPaint("screen2")
      } catch { fail() }
    })
    document.querySelectorAll<HTMLInputElement>("input[name=q2]").forEach((r) =>
      r.addEventListener("change", () => saveAnswer(token, d.questions[1].id, { value: Number(r.value) }).catch(fail)),
    )
    $("#comment").addEventListener("change", async (e) => {
      try {
        const r = await saveAnswer(token, d.questions[1].id, { comment: (e.target as HTMLTextAreaElement).value })
        $("#lead").textContent = t("comment.leadSees", { text: r.shownToLead ?? "" })
      } catch { fail() }
    })
    $("#next").addEventListener("click", () => show(3))
  })
  .catch(fail)
