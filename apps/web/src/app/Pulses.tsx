import { Button } from "@base-ui/react/button";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import {
  Dimension,
  type PulseDetail,
  type PulseId,
  type PulseQuestion,
  PulseSettings,
  type PulseWarning,
  QuestionContent,
  type QuestionId,
  type QuestionType,
  type TeamId,
  Weekday,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import { useCallback, useState } from "react";
import { message, pluralMessage } from "../messages/index.ts";
import {
  buttonClass,
  inputClass,
  invalid,
  Problem,
  pulseHref,
  pulsesHref,
  teamHref,
  TextField,
  useChange,
  useView,
} from "./Directory.tsx";
import { callPulses, type Outcome } from "./directory.ts";

const linkButton = "text-sm underline disabled:opacity-50";

const dimensionName = (dimension: Dimension | null) =>
  dimension === null ? message("dimension.none") : message(`dimension.${dimension}`);

const typeName = (type: QuestionType) => message(`questionType.${type._tag}`);

const warningMessage = (warning: PulseWarning): string => {
  switch (warning._tag) {
    case "TooManyQuestions":
      return message("pulse.warning.TooManyQuestions", warning);
    case "TooLong":
      return message("pulse.warning.TooLong", warning);
    case "NoOneTap":
      return message("pulse.warning.NoOneTap");
    case "TeamBelowMinimumGroupSize":
      return message("pulse.warning.TeamBelowMinimumGroupSize", warning);
  }
};

/** A native select over a fixed list of values; the change hands back the value, never a raw string. */
function SelectField<V extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: V;
  readonly options: ReadonlyArray<readonly [V, string]>;
  readonly onChange: (value: V) => void;
}) {
  return (
    <Field.Root>
      <Field.Label className="block text-sm font-medium">{label}</Field.Label>
      <select
        className={inputClass}
        value={String(value)}
        onChange={(event) => {
          const picked = options.find(([option]) => String(option) === event.target.value);
          if (picked !== undefined) onChange(picked[0]);
        }}
      >
        {options.map(([option, name]) => (
          <option key={String(option)} value={String(option)}>
            {name}
          </option>
        ))}
      </select>
    </Field.Root>
  );
}

/** A Team's Pulses, and a button that creates one from the weekly team health Template. */
export function PulsesScreen({ teamId }: { readonly teamId: TeamId }) {
  const load = useCallback(() => callPulses((api) => api.listPulses({ params: { teamId } })), [teamId]);
  const [view] = useView(load);
  const { busy, failure, change } = useChange();
  return (
    <section className="mt-6">
      <a href={teamHref(teamId)} className="text-sm underline">
        {message("pulses.back")}
      </a>
      {view._tag === "Failed" ? <Problem failure={view.failure} /> : null}
      {view._tag === "Loaded" ? (
        <>
          <h2 className="mt-2 text-xl font-semibold">
            {message("pulses.title", { team: view.value.team.name })}
          </h2>
          {view.value.pulses.length === 0 ? (
            <p className="mt-2 text-gray-600">{message("pulses.empty")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {view.value.pulses.map((pulse) => (
                <li key={pulse.id}>
                  <a
                    href={pulseHref(teamId, pulse.id)}
                    className="flex justify-between rounded border px-3 py-2"
                  >
                    <span>{pulse.name}</span>
                    <span className="text-sm text-gray-600">
                      {message("pulses.summary", {
                        day: message(`weekday.${pulse.cadence.day}`),
                        time: pulse.cadence.time,
                        questions: pluralMessage("pulse.questionCount", pulse.questionCount),
                        seconds: pulse.estimatedSeconds,
                      })}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-sm text-gray-600">{message("pulses.create.intro")}</p>
          <Problem failure={failure} />
          <Button
            disabled={busy}
            className={`mt-2 ${buttonClass}`}
            onClick={() =>
              change(
                () => callPulses((api) => api.createPulse({ params: { teamId } })),
                (created) => {
                  window.location.hash = pulseHref(teamId, created.id);
                },
              )
            }
          >
            {message("pulses.create.action")}
          </Button>
        </>
      ) : null}
    </section>
  );
}

const WEEKDAYS = Weekday.literals.map((day) => [day, message(`weekday.${day}`)] as const);
const WINDOWS = [1, 2, 3, 4, 5, 6].map((days) => [days, pluralMessage("pulse.settings.days", days)] as const);
const REMINDERS = [0, 1, 2].map(
  (count) => [count, pluralMessage("pulse.settings.reminderCount", count)] as const,
);
const decodeSettings = Schema.decodeUnknownOption(PulseSettings);

function SettingsForm({
  detail,
  onSaved,
}: {
  readonly detail: PulseDetail;
  readonly onSaved: (detail: PulseDetail) => void;
}) {
  const { settings } = detail;
  const [name, setName] = useState(settings.name);
  const [day, setDay] = useState(settings.cadence.day);
  const [time, setTime] = useState<string>(settings.cadence.time);
  const [answerWindowDays, setWindow] = useState(settings.answerWindowDays);
  const [reminders, setReminders] = useState(settings.reminders);
  const [saved, setSaved] = useState(false);
  const { busy, failure, change } = useChange();
  return (
    <Form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        const parsed = decodeSettings({
          ...settings,
          name: name.trim(),
          cadence: { _tag: "Weekly", day, time },
          answerWindowDays,
          reminders,
        });
        change(
          () =>
            Option.isNone(parsed)
              ? invalid()
              : callPulses((api) =>
                  api.updatePulseSettings({
                    params: { teamId: detail.team.id, pulseId: detail.id },
                    payload: parsed.value,
                  }),
                ),
          (updated) => {
            setSaved(true);
            onSaved(updated);
          },
        );
      }}
    >
      <h3 className="text-lg font-medium">{message("pulse.settings.title")}</h3>
      <TextField label={message("pulse.settings.name")} value={name} onChange={setName} />
      <SelectField label={message("pulse.settings.day")} value={day} options={WEEKDAYS} onChange={setDay} />
      <TextField label={message("pulse.settings.time")} value={time} onChange={setTime} type="time" />
      <p className="text-sm text-gray-600">{message("pulse.settings.time.help")}</p>
      <SelectField
        label={message("pulse.settings.answerWindow")}
        value={answerWindowDays}
        options={WINDOWS}
        onChange={setWindow}
      />
      <SelectField
        label={message("pulse.settings.reminders")}
        value={reminders}
        options={REMINDERS}
        onChange={setReminders}
      />
      <p className="text-sm text-gray-600">{message("pulse.settings.anonymous")}</p>
      <p className="text-sm text-gray-600">{message("pulse.settings.invitation")}</p>
      <Problem failure={failure} />
      {saved ? <p role="status">{message("pulse.settings.saved")}</p> : null}
      <Button type="submit" disabled={busy} className={buttonClass}>
        {message("pulse.settings.save")}
      </Button>
    </Form>
  );
}

type Kind = QuestionType["_tag"];
const KINDS: ReadonlyArray<readonly [Kind, string]> = (["Rating", "SingleChoice", "LongText"] as const).map(
  (kind) => [kind, message(`questionType.${kind}`)] as const,
);
const DIMENSIONS: ReadonlyArray<readonly [Dimension | "none", string]> = [
  ["none", message("dimension.none")],
  ...Dimension.literals.map((dimension) => [dimension, message(`dimension.${dimension}`)] as const),
];
const decodeContent = Schema.decodeUnknownOption(QuestionContent);

/** Writes a new Question, or rewrites one without Answers. */
function QuestionForm({
  initial,
  title,
  action,
  save,
  onDone,
}: {
  readonly initial?: PulseQuestion;
  readonly title: string;
  readonly action: string;
  readonly save: (content: QuestionContent) => Promise<Outcome<PulseDetail>>;
  readonly onDone: (detail: PulseDetail) => void;
}) {
  const type = initial?.type;
  const [text, setText] = useState(initial?.text ?? "");
  const [dimension, setDimension] = useState<Dimension | "none">(initial?.dimension ?? "none");
  const [kind, setKind] = useState<Kind>(type?._tag ?? "Rating");
  const [lowLabel, setLow] = useState(type?._tag === "Rating" ? type.lowLabel : "");
  const [highLabel, setHigh] = useState(type?._tag === "Rating" ? type.highLabel : "");
  const [comment, setComment] = useState(type?._tag === "Rating" ? type.comment : true);
  const [options, setOptions] = useState(type?._tag === "SingleChoice" ? type.options.join("\n") : "");
  const { busy, failure, change } = useChange();
  return (
    <Form
      className="mt-4 flex flex-col gap-3 rounded border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const typed =
          kind === "Rating"
            ? { _tag: kind, lowLabel: lowLabel.trim(), highLabel: highLabel.trim(), comment }
            : kind === "SingleChoice"
              ? {
                  _tag: kind,
                  options: options
                    .split("\n")
                    .map((option) => option.trim())
                    .filter((option) => option !== ""),
                }
              : { _tag: kind };
        const parsed = decodeContent({
          text: text.trim(),
          dimension: dimension === "none" ? null : dimension,
          type: typed,
        });
        change(() => (Option.isNone(parsed) ? invalid() : save(parsed.value)), onDone);
      }}
    >
      <h4 className="font-medium">{title}</h4>
      <TextField label={message("question.text")} value={text} onChange={setText} />
      <SelectField label={message("question.type")} value={kind} options={KINDS} onChange={setKind} />
      {kind === "Rating" ? (
        <>
          <TextField label={message("question.lowLabel")} value={lowLabel} onChange={setLow} />
          <TextField label={message("question.highLabel")} value={highLabel} onChange={setHigh} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={comment} onChange={(event) => setComment(event.target.checked)} />
            {message("question.comment")}
          </label>
        </>
      ) : null}
      {kind === "SingleChoice" ? (
        <Field.Root>
          <Field.Label className="block text-sm font-medium">{message("question.options")}</Field.Label>
          <textarea
            className={inputClass}
            rows={4}
            value={options}
            onChange={(event) => setOptions(event.target.value)}
          />
        </Field.Root>
      ) : null}
      {kind === "LongText" ? (
        <p className="text-sm text-gray-600">{message("question.longText.help")}</p>
      ) : null}
      <SelectField
        label={message("question.dimension")}
        value={dimension}
        options={DIMENSIONS}
        onChange={setDimension}
      />
      <Problem failure={failure} />
      <Button type="submit" disabled={busy} className={buttonClass}>
        {action}
      </Button>
    </Form>
  );
}

function QuestionItem({
  detail,
  question,
  index,
  onChanged,
}: {
  readonly detail: PulseDetail;
  readonly question: PulseQuestion;
  readonly index: number;
  readonly onChanged: (detail: PulseDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { busy, failure, change } = useChange();
  const params = { teamId: detail.team.id, pulseId: detail.id };
  const order = detail.questions.map((each) => each.questionId);
  const move = (by: -1 | 1) => {
    const next: Array<QuestionId> = [...order];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    change(() => callPulses((api) => api.reorderQuestions({ params, payload: { order: next } })), onChanged);
  };
  return (
    <li className="rounded border px-3 py-2">
      <p>
        {message("pulse.question.number", { number: index + 1 })} {question.text}
      </p>
      <p className="text-sm text-gray-600">
        {message("pulse.question.meta", {
          type: typeName(question.type),
          dimension: dimensionName(question.dimension),
          seconds: question.estimatedSeconds,
        })}
      </p>
      <div className="mt-1 flex gap-4">
        <Button disabled={busy || index === 0} className={linkButton} onClick={() => move(-1)}>
          {message("pulse.question.up")}
        </Button>
        <Button disabled={busy || index === order.length - 1} className={linkButton} onClick={() => move(1)}>
          {message("pulse.question.down")}
        </Button>
        {question.hasAnswers ? null : (
          <Button disabled={busy} className={linkButton} onClick={() => setEditing(!editing)}>
            {message("pulse.question.edit")}
          </Button>
        )}
        <Button
          disabled={busy}
          className={linkButton}
          onClick={() =>
            change(
              () =>
                callPulses((api) =>
                  api.removeQuestion({ params: { ...params, questionId: question.questionId } }),
                ),
              onChanged,
            )
          }
        >
          {message("pulse.question.remove")}
        </Button>
      </div>
      {question.hasAnswers ? (
        <p className="text-sm text-gray-600">{message("pulse.question.answered")}</p>
      ) : null}
      <Problem failure={failure} />
      {editing ? (
        <QuestionForm
          initial={question}
          title={message("pulse.question.edit")}
          action={message("pulse.question.save")}
          save={(content) =>
            callPulses((api) =>
              api.editQuestion({ params: { ...params, questionId: question.questionId }, payload: content }),
            )
          }
          onDone={(updated) => {
            setEditing(false);
            onChanged(updated);
          }}
        />
      ) : null}
    </li>
  );
}

function TemplateQuestions({
  detail,
  onChanged,
}: {
  readonly detail: PulseDetail;
  readonly onChanged: (detail: PulseDetail) => void;
}) {
  const { busy, failure, change } = useChange();
  if (detail.templateQuestions.length === 0) return null;
  return (
    <>
      <h3 className="mt-6 text-lg font-medium">{message("pulse.template.title")}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {detail.templateQuestions.map((question) => (
          <li key={question.key} className="flex items-center justify-between rounded border px-3 py-2">
            <span>
              {question.text}{" "}
              <span className="text-sm text-gray-600">{dimensionName(question.dimension)}</span>
            </span>
            <Button
              disabled={busy}
              className={linkButton}
              onClick={() =>
                change(
                  () =>
                    callPulses((api) =>
                      api.addQuestion({
                        params: { teamId: detail.team.id, pulseId: detail.id },
                        payload: { _tag: "FromTemplate", key: question.key },
                      }),
                    ),
                  onChanged,
                )
              }
            >
              {message("pulse.template.add")}
            </Button>
          </li>
        ))}
      </ul>
      <Problem failure={failure} />
    </>
  );
}

/** The Pulse editor: Questions in order with the estimate and warnings, then the settings. */
function PulseEditor({ initial }: { readonly initial: PulseDetail }) {
  const [detail, setDetail] = useState(initial);
  const [writing, setWriting] = useState(false);
  return (
    <>
      <h2 className="mt-2 text-xl font-semibold">{detail.settings.name}</h2>
      <p className="text-sm text-gray-600">{detail.team.name}</p>
      <p className="mt-4" role="status">
        {message("pulse.estimate", {
          questions: pluralMessage("pulse.questionCount", detail.questions.length),
          seconds: detail.estimatedSeconds,
        })}
      </p>
      {detail.warnings.length === 0 ? null : (
        <ul className="mt-2 flex flex-col gap-1">
          {detail.warnings.map((warning) => (
            <li key={warning._tag} className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {warningMessage(warning)}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-6 text-lg font-medium">{message("pulse.questions")}</h3>
      <ol className="mt-2 flex flex-col gap-2">
        {detail.questions.map((question, index) => (
          <QuestionItem
            key={question.questionId}
            detail={detail}
            question={question}
            index={index}
            onChanged={setDetail}
          />
        ))}
      </ol>
      <TemplateQuestions detail={detail} onChanged={setDetail} />
      {writing ? (
        <QuestionForm
          title={message("pulse.write.title")}
          action={message("pulse.write.action")}
          save={(content) =>
            callPulses((api) =>
              api.addQuestion({
                params: { teamId: detail.team.id, pulseId: detail.id },
                payload: { _tag: "Written", ...content },
              }),
            )
          }
          onDone={(updated) => {
            setWriting(false);
            setDetail(updated);
          }}
        />
      ) : (
        <Button className={`mt-4 ${buttonClass}`} onClick={() => setWriting(true)}>
          {message("pulse.write.title")}
        </Button>
      )}
      <SettingsForm detail={detail} onSaved={setDetail} />
    </>
  );
}

export function PulseScreen({ teamId, pulseId }: { readonly teamId: TeamId; readonly pulseId: PulseId }) {
  const load = useCallback(
    () => callPulses((api) => api.getPulse({ params: { teamId, pulseId } })),
    [teamId, pulseId],
  );
  const [view] = useView(load);
  return (
    <section className="mt-6">
      <a href={pulsesHref(teamId)} className="text-sm underline">
        {message("pulse.back")}
      </a>
      {view._tag === "Failed" ? <Problem failure={view.failure} /> : null}
      {view._tag === "Loaded" ? <PulseEditor initial={view.value} /> : null}
    </section>
  );
}
