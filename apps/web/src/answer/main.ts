import type { AnswerMessage } from "./answer-messages.ts";
import { keepAnswer } from "./kept-answers.ts";
import { anonymityStatement, type QuestionData, parseRoundContext } from "./round-context.ts";
import { scaleText } from "./scale.ts";

declare global {
  interface Window {
    __sb_token?: string | undefined;
    __sb_v?: number | undefined;
    __sb_submitOrigin?: string | undefined;
    __exchangePromise?: Promise<unknown> | undefined;
  }
}

function getSubmitOrigin(): string {
  if (typeof window.__sb_submitOrigin === "string" && window.__sb_submitOrigin.length > 0) {
    return window.__sb_submitOrigin;
  }
  const host = window.location.hostname;
  if (host === "dashboard.surveybeat.app" || host === "app.surveybeat.app") {
    return "https://submit.surveybeat.app";
  }
  if (host.endsWith(".dashboard.surveybeat.app")) {
    return `https://${host.replace(".dashboard.surveybeat.app", ".submit.surveybeat.app")}`;
  }
  if (host.endsWith(".app.surveybeat.app")) {
    return `https://${host.replace(".app.surveybeat.app", ".submit.surveybeat.app")}`;
  }
  return window.location.origin;
}

function getStoredToken(): string {
  const fromWindow = window.__sb_token;
  if (typeof fromWindow === "string" && fromWindow.length > 0) {
    return fromWindow;
  }
  const hash = window.location.hash;
  if (hash.length > 1) {
    const params = new URLSearchParams(hash.slice(1));
    const t = params.get("t");
    if (typeof t === "string" && t.length > 0) {
      window.sessionStorage.setItem("sb_token", t);
      return t;
    }
  }
  const stored = window.sessionStorage.getItem("sb_token");
  return typeof stored === "string" ? stored : "";
}

function generateEditKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mark(name: string): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    performance.mark(name);
  }
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`);
    throw Object.assign(error, { status: res.status });
  }
  const data: unknown = await res.json();
  return data;
}

function extractShownToLead(data: unknown): string | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "shownToLead" in data &&
    typeof data.shownToLead === "string"
  ) {
    return data.shownToLead;
  }
  return null;
}

function showError(msg: string): void {
  const err = document.getElementById("err");
  if (err instanceof HTMLElement) {
    err.textContent = msg;
    err.hidden = false;
  }
}

/** A save that succeeds after a failed one clears the stale error. */
function clearError(): void {
  const err = document.getElementById("err");
  if (err instanceof HTMLElement) {
    err.hidden = true;
    err.textContent = "";
  }
}

function hideFormScreens(): void {
  for (const id of ["screen-1", "remaining-screens", "screen-thanks"]) {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) {
      el.hidden = true;
    }
  }
}

function showStateMessage(msg: string): void {
  const box = document.getElementById("state-message");
  if (box instanceof HTMLElement) {
    box.className = "state-box";
    const p = document.createElement("p");
    p.textContent = msg;
    box.replaceChildren(p);
    box.hidden = false;
  }
  hideFormScreens();
}

/** For failures before the form can work (no token, failed exchange, unreadable context): the form is hidden. */
function showFatalError(msg: string): void {
  showError(msg);
  hideFormScreens();
}

async function run(message: AnswerMessage): Promise<void> {
  document.title = message("answer.title");

  const saveBtn = document.getElementById("save");

  // Read preselected value
  let preselectedV = typeof window.__sb_v === "number" ? window.__sb_v : undefined;
  if (preselectedV === undefined && window.location.hash.length > 1) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const vParam = params.get("v");
    if (typeof vParam === "string") {
      const parsed = parseInt(vParam, 10);
      if (parsed >= 1 && parsed <= 5) {
        preselectedV = parsed;
      }
    }
  }

  if (typeof preselectedV === "number") {
    const initialRadio = document.querySelector(`input[name="q1"][value="${preselectedV}"]`);
    if (initialRadio instanceof HTMLInputElement) {
      initialRadio.checked = true;
    }
  }

  // Strip fragment so token does not linger in history (ADR 0005)
  if (window.location.hash.length > 0) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  const token = getStoredToken();
  const submitOrigin = getSubmitOrigin();

  let exchangePromise = window.__exchangePromise;
  if (!exchangePromise) {
    if (token.length === 0) {
      showFatalError(message("answer.error"));
      return;
    }
    exchangePromise = postJson(`${submitOrigin}/exchange`, { token });
  }

  let rawContext: unknown;
  try {
    rawContext = await exchangePromise;
  } catch {
    showFatalError(message("answer.error"));
    return;
  }

  const context = parseRoundContext(rawContext);
  if (context === null) {
    showFatalError(message("answer.error"));
    return;
  }

  // A test Invitation (ADR 0021) says so before the Question shows. Nothing it sends is saved.
  if (context.test) {
    const testBanner = document.getElementById("test-banner");
    if (testBanner instanceof HTMLElement) {
      testBanner.textContent = message("answer.test.banner");
      testBanner.hidden = false;
    }
  }

  // What the lead will and will not see needs the Team's N, so it waits for the context.
  const anonEl = document.getElementById("anon");
  if (anonEl instanceof HTMLElement) {
    anonEl.textContent = anonymityStatement(context, message);
  }

  // Trigger dynamic schema validation after first paint (keeps Effect Schema off critical path)
  const scheduleValidation = () => {
    void import("./schema-validate.ts").then((mod) => {
      mod.validateRoundContext(rawContext);
    });
  };
  setTimeout(scheduleValidation, 8000);

  // Check state
  if (context.state !== "open") {
    showStateMessage(message("answer.state.closed"));
    return;
  }

  const roundStorageKey = `sb_edit_${context.roundId}`;
  // A test keeps its Edit key in memory only, and the browser stores nothing for it (ADR 0021).
  let editKey = context.test ? "" : (window.localStorage.getItem(roundStorageKey) ?? "");

  if (context.hasAnswered) {
    if (editKey.length === 0) {
      showStateMessage(message("answer.state.otherBrowser"));
      return;
    }
    // Member has edit key on this device; proceed to allow editing/reviewing answers
  }

  // Populate Screen 1
  const pulseEl = document.getElementById("pulse");
  if (pulseEl instanceof HTMLElement) {
    pulseEl.textContent = context.pulseName;
  }

  const q1 = context.questions[0];
  if (q1) {
    const q1text = document.getElementById("q1text");
    if (q1text instanceof HTMLElement) {
      q1text.textContent = q1.text;
    }
    // The ends of the scale carry the Question's own labels; the prerendered page shows plain numbers until now.
    const lowLabel = q1.type._tag === "Rating" ? q1.type.lowLabel : undefined;
    const highLabel = q1.type._tag === "Rating" ? q1.type.highLabel : undefined;
    const q1low = document.getElementById("q1low");
    if (q1low instanceof HTMLElement) {
      q1low.textContent = scaleText(1, lowLabel, highLabel);
    }
    const q1high = document.getElementById("q1high");
    if (q1high instanceof HTMLElement) {
      q1high.textContent = scaleText(5, lowLabel, highLabel);
    }
  }

  if (saveBtn instanceof HTMLButtonElement) {
    saveBtn.disabled = false;
  }

  mark("meaningful");

  let firstSaved = context.hasAnswered;

  const doFirstSave = async (ratingVal: number): Promise<void> => {
    if (firstSaved) return;
    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.disabled = true;
    }
    mark("first-save-start");
    try {
      editKey = generateEditKey();
      const editKeyHash = await sha256Hex(editKey);
      if (!context.test) window.localStorage.setItem(roundStorageKey, editKey);

      await postJson(`${submitOrigin}/first-answer`, {
        token,
        editKeyHash,
        questionVersionId: q1 ? q1.id : "",
        value: ratingVal,
      });
      clearError();

      // A test's answers stay out of the browser's kept answers, so member history never shows them (ADR 0017).
      if (q1 && !context.test) {
        keepAnswer(() => window.localStorage, context.roundId, q1.id, { value: ratingVal }, Date.now());
      }
      firstSaved = true;
      // Invariant: after the first save, no request carries the token (ADR 0005)
      window.sessionStorage.removeItem("sb_token");
      window.__sb_token = undefined;

      mark("first-save-end");
      mark("screen2");
      goToRemainingScreens();
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "status" in err && err.status === 409) {
        showStateMessage(message("answer.state.alreadyAnswered"));
        return;
      }
      showError(message("answer.error"));
      if (saveBtn instanceof HTMLButtonElement) {
        saveBtn.disabled = false;
      }
    }
  };

  // Screen 1 form submit
  const f1 = document.getElementById("f1");
  if (f1 instanceof HTMLFormElement) {
    f1.addEventListener("submit", (e) => {
      e.preventDefault();
      const checked = document.querySelector('input[name="q1"]:checked');
      if (checked instanceof HTMLInputElement) {
        void doFirstSave(Number(checked.value));
      }
    });
  }

  // Value change on Screen 1 also confirms first save (ADR 0007)
  const q1Radios = document.querySelectorAll('input[name="q1"]');
  q1Radios.forEach((r) => {
    if (r instanceof HTMLInputElement) {
      r.addEventListener("change", () => {
        void doFirstSave(Number(r.value));
      });
    }
  });

  const goToRemainingScreens = () => {
    const s1 = document.getElementById("screen-1");
    if (s1 instanceof HTMLElement) {
      s1.hidden = true;
    }

    const remainingQuestions = context.questions.slice(1);
    if (remainingQuestions.length === 0) {
      goToThanksScreen();
      return;
    }

    renderRemainingQuestions(remainingQuestions);
  };

  const goToThanksScreen = () => {
    const s1 = document.getElementById("screen-1");
    if (s1 instanceof HTMLElement) {
      s1.hidden = true;
    }
    const rem = document.getElementById("remaining-screens");
    if (rem instanceof HTMLElement) {
      rem.hidden = true;
    }

    const thanks = document.getElementById("screen-thanks");
    if (thanks instanceof HTMLElement) {
      thanks.hidden = false;
      const h2 = thanks.querySelector("h2");
      if (h2 instanceof HTMLElement) {
        h2.focus();
      }
    }

    const bodyEl = document.getElementById("thanks-body");
    const actionsUl = document.getElementById("actions");
    if (context.actions.length > 0) {
      if (bodyEl instanceof HTMLElement) {
        bodyEl.textContent = context.test ? message("answer.test.thanks") : message("answer.thanks.body");
      }
      if (actionsUl instanceof HTMLUListElement) {
        actionsUl.replaceChildren(
          ...context.actions.slice(0, 3).map((act) => {
            const li = document.createElement("li");
            li.textContent = act.title;
            return li;
          }),
        );
      }
    } else {
      if (bodyEl instanceof HTMLElement) {
        bodyEl.textContent = context.test
          ? message("answer.test.thanks")
          : message("answer.thanks.bodyNoActions");
      }
      if (actionsUl instanceof HTMLElement) {
        actionsUl.replaceChildren();
      }
    }
  };

  const renderRemainingQuestions = (questions: ReadonlyArray<QuestionData>) => {
    const container = document.getElementById("remaining-screens");
    if (!(container instanceof HTMLElement)) return;

    container.hidden = false;
    container.replaceChildren();

    const isDesktop = window.matchMedia("(min-width: 640px)").matches;
    document.body.classList.toggle("is-desktop", isDesktop);

    const questionSections: Array<HTMLElement> = [];

    questions.forEach((q, idx) => {
      const section = document.createElement("section");
      section.setAttribute("data-question-screen", String(idx + 2));
      section.className = "question-block";
      // On mobile, hide screens past the first remaining question
      if (!isDesktop && idx > 0) {
        section.hidden = true;
      }

      const fieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.tabIndex = -1;
      legend.textContent = q.text;
      fieldset.appendChild(legend);

      if (q.type._tag === "Rating") {
        const scaleDiv = document.createElement("div");
        scaleDiv.className = "scale";
        for (let i = 1; i <= 5; i++) {
          const lbl = document.createElement("label");
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `q_${q.id}`;
          radio.value = String(i);

          radio.addEventListener("change", () => {
            void saveAnswer(q.id, { value: i });
          });

          const span = document.createElement("span");
          span.textContent = scaleText(i, q.type.lowLabel, q.type.highLabel);
          lbl.appendChild(radio);
          lbl.appendChild(span);
          scaleDiv.appendChild(lbl);
        }
        fieldset.appendChild(scaleDiv);
      } else if (q.type._tag === "SingleChoice") {
        const scaleDiv = document.createElement("div");
        scaleDiv.className = "scale";
        q.type.options.forEach((opt, optIdx) => {
          const lbl = document.createElement("label");
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `q_${q.id}`;
          radio.value = String(optIdx);

          radio.addEventListener("change", () => {
            void saveAnswer(q.id, { value: optIdx });
          });

          const span = document.createElement("span");
          span.textContent = opt;
          lbl.appendChild(radio);
          lbl.appendChild(span);
          scaleDiv.appendChild(lbl);
        });
        fieldset.appendChild(scaleDiv);
      }

      section.appendChild(fieldset);

      // Comments: Rating with comment=true, or LongText
      const hasComment = (q.type._tag === "Rating" && q.type.comment === true) || q.type._tag === "LongText";

      if (hasComment) {
        const commentDiv = document.createElement("div");
        commentDiv.className = "comment-section";

        const lbl = document.createElement("label");
        lbl.htmlFor = `comment_${q.id}`;
        lbl.className = "comment-label";
        lbl.textContent = message("answer.comment.label");
        commentDiv.appendChild(lbl);

        const disclosure = document.createElement("p");
        disclosure.className = "comment-disclosure";
        disclosure.id = `disclosure_${q.id}`;
        disclosure.textContent = message("answer.comment.disclosure");
        commentDiv.appendChild(disclosure);

        const textarea = document.createElement("textarea");
        textarea.id = `comment_${q.id}`;
        textarea.maxLength = 1000;
        textarea.setAttribute("aria-describedby", `disclosure_${q.id}`);

        const leadP = document.createElement("p");
        leadP.className = "lead-preview";
        leadP.setAttribute("aria-live", "polite");

        const saveComment = async () => {
          const val = textarea.value.trim();
          if (val.length === 0) return;
          try {
            const raw = await saveAnswer(q.id, { comment: val });
            const shownToLead = extractShownToLead(raw);
            if (shownToLead !== null) {
              leadP.textContent = message("answer.comment.leadSees", { text: shownToLead });
            }
          } catch {
            showError(message("answer.error"));
          }
        };

        textarea.addEventListener("change", () => {
          void saveComment();
        });
        textarea.addEventListener("blur", () => {
          void saveComment();
        });

        commentDiv.appendChild(textarea);
        commentDiv.appendChild(leadP);
        section.appendChild(commentDiv);
      }

      // Navigation buttons
      const isLast = idx === questions.length - 1;
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "mobile-next-btn";
      nextBtn.textContent = isLast ? message("answer.finish") : message("answer.next");
      nextBtn.addEventListener("click", () => {
        if (isLast) {
          goToThanksScreen();
        } else {
          section.hidden = true;
          const nextSec = questionSections[idx + 1];
          if (nextSec instanceof HTMLElement) {
            nextSec.hidden = false;
            const leg = nextSec.querySelector("legend");
            if (leg instanceof HTMLElement) {
              leg.focus();
            }
          }
        }
      });
      section.appendChild(nextBtn);

      questionSections.push(section);
      container.appendChild(section);
    });

    // Desktop finish button
    const finishBtn = document.createElement("button");
    finishBtn.type = "button";
    finishBtn.className = "desktop-finish-btn";
    finishBtn.textContent = message("answer.finish");
    finishBtn.addEventListener("click", () => {
      goToThanksScreen();
    });
    container.appendChild(finishBtn);

    // Focus the first remaining question legend
    const firstLegend = questionSections[0]?.querySelector("legend");
    if (firstLegend instanceof HTMLElement) {
      firstLegend.focus();
    }
  };

  const saveAnswer = async (
    questionVersionId: string,
    body: { value?: number; comment?: string },
  ): Promise<unknown> => {
    mark("answer-save-start");
    // Invariant: Subsequent answers carry editKey, NEVER token (ADR 0005)
    const result = await postJson(`${submitOrigin}/answer`, {
      editKey,
      questionVersionId,
      ...body,
    });
    clearError();
    if (!context.test) {
      keepAnswer(() => window.localStorage, context.roundId, questionVersionId, body, Date.now());
    }
    mark("answer-save-end");
    return result;
  };
}

/** Runs the answer page with one locale's messages. Each entry module (en.ts, de.ts) calls this once. */
export function start(message: AnswerMessage): void {
  void run(message);
}
