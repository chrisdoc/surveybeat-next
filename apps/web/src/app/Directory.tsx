import { Button } from "@base-ui/react/button";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import {
  EmailAddress,
  MinimumGroupSize,
  type OrganizationSettings,
  PersonId,
  PulseId,
  type TeamDetail,
  TeamId,
  type TeamSummary,
  TeamName,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Schema } from "effect";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { formatDate, message } from "../messages/index.ts";
import { call, type Failure, type Outcome } from "./directory.ts";

export const buttonClass = "rounded bg-black px-4 py-2 text-white disabled:opacity-50";
export const inputClass = "mt-1 w-full rounded border px-3 py-2";

export type Route =
  | { readonly _tag: "Teams" }
  | { readonly _tag: "Team"; readonly id: TeamId }
  | { readonly _tag: "Pulses"; readonly teamId: TeamId }
  | { readonly _tag: "Pulse"; readonly teamId: TeamId; readonly pulseId: PulseId }
  | { readonly _tag: "Settings" };

const decodeTeamId = Schema.decodeUnknownOption(TeamId);
const decodePulseId = Schema.decodeUnknownOption(PulseId);

const parseRoute = (hash: string): Route => {
  if (hash === "#/settings") return { _tag: "Settings" };
  const match = /^#\/teams\/([^/]+)(?:\/(pulses)(?:\/([^/]+))?)?$/.exec(hash);
  const id = match?.[1] === undefined ? Option.none() : decodeTeamId(decodeURIComponent(match[1]));
  if (Option.isNone(id)) return { _tag: "Teams" };
  if (match?.[2] === undefined) return { _tag: "Team", id: id.value };
  const pulseId = match[3] === undefined ? Option.none() : decodePulseId(decodeURIComponent(match[3]));
  return Option.isSome(pulseId)
    ? { _tag: "Pulse", teamId: id.value, pulseId: pulseId.value }
    : { _tag: "Pulses", teamId: id.value };
};

/** The page, from the URL hash, so Back and bookmarks work without a router. */
export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

export const teamHref = (id: TeamId) => `#/teams/${encodeURIComponent(id)}`;
export const pulsesHref = (teamId: TeamId) => `${teamHref(teamId)}/pulses`;
export const pulseHref = (teamId: TeamId, pulseId: PulseId) =>
  `${pulsesHref(teamId)}/${encodeURIComponent(pulseId)}`;

/** The signed-in frame: heading, navigation, and sign out. */
export function Shell({
  title,
  organizationAdmin,
  signOut,
  children,
}: {
  readonly title: string;
  readonly organizationAdmin: boolean;
  readonly signOut: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <nav className="mt-4 flex gap-4">
        <a href="#/" className="underline">
          {message("nav.teams")}
        </a>
        {organizationAdmin ? (
          <a href="#/settings" className="underline">
            {message("nav.settings")}
          </a>
        ) : null}
      </nav>
      {children}
      {signOut}
    </main>
  );
}

const failureMessage = (failure: Failure): string => {
  switch (failure) {
    case "Unauthenticated":
      return message("error.Unauthenticated");
    case "Forbidden":
      return message("error.Forbidden");
    case "NotFound":
      return message("error.NotFound");
    case "LastLead":
      return message("error.LastLead");
    case "LastAdmin":
      return message("error.LastAdmin");
    case "TeamNameTaken":
      return message("error.TeamNameTaken");
    case "QuestionAlreadyInPulse":
      return message("error.QuestionAlreadyInPulse");
    case "QuestionHasAnswers":
      return message("error.QuestionHasAnswers");
    case "PulseNeedsAQuestion":
      return message("error.PulseNeedsAQuestion");
    case "PulseFull":
      return message("error.PulseFull");
    case "OrderMismatch":
      return message("error.OrderMismatch");
    case "Invalid":
      return message("error.Invalid");
    case "Unavailable":
      return message("error.Unavailable");
  }
};

const roleName = (role: TeamSummary["yourRole"]) => (role === null ? "" : message(`role.${role}`));

export function Problem({ failure }: { readonly failure: Failure | undefined }) {
  return failure === undefined ? null : (
    <p role="alert" className="mt-2 text-red-700">
      {failureMessage(failure)}
    </p>
  );
}

export type Loaded<A> =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Loaded"; readonly value: A }
  | { readonly _tag: "Failed"; readonly failure: Failure };

/** Loads a view, and again after every change (a change can end the caller's own access). */
export function useView<A>(load: () => Promise<Outcome<A>>) {
  const [state, setState] = useState<Loaded<A>>({ _tag: "Loading" });
  const reload = useCallback(() => {
    void load().then((outcome) => {
      if (outcome.ok) setState({ _tag: "Loaded", value: outcome.value });
      else if (outcome.failure === "Unauthenticated") window.location.reload();
      else setState({ _tag: "Failed", failure: outcome.failure });
    });
  }, [load]);
  useEffect(reload, [reload]);
  return [state, reload] as const;
}

/** Runs one change at a time; `after` runs when it worked, otherwise the failure shows. */
export function useChange() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const change = <A,>(run: () => Promise<Outcome<A>>, after: (value: A) => void) => {
    setBusy(true);
    setFailure(undefined);
    void run().then((outcome) => {
      setBusy(false);
      if (outcome.ok) after(outcome.value);
      else if (outcome.failure === "Unauthenticated") window.location.reload();
      else setFailure(outcome.failure);
    });
  };
  return { busy, failure, change };
}

/** A failed decode of what was typed, reported like a refusal from the server. */
export const invalid = (): Promise<Outcome<never>> => Promise.resolve({ ok: false, failure: "Invalid" });

export function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "email" | "number" | "time";
}) {
  return (
    <Field.Root>
      <Field.Label className="block text-sm font-medium">{label}</Field.Label>
      <Field.Control required type={type} value={value} onValueChange={onChange} className={inputClass} />
    </Field.Root>
  );
}

const decodeName = Schema.decodeUnknownOption(TeamName);
const decodeZone = Schema.decodeUnknownOption(TimeZone);
const decodeEmail = Schema.decodeUnknownOption(EmailAddress);
const decodeSize = Schema.decodeUnknownOption(MinimumGroupSize);
const decodePerson = Schema.decodeUnknownOption(PersonId);

function CreateTeam() {
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [lead, setLead] = useState("");
  const { busy, failure, change } = useChange();
  return (
    <Form
      className="mt-6 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = [
          decodeName(name.trim()),
          decodeZone(timeZone.trim()),
          decodeEmail(lead.trim()),
        ] as const;
        change(
          () => {
            const [n, z, e] = parsed;
            if (Option.isNone(n) || Option.isNone(z) || Option.isNone(e)) return invalid();
            return call((api) =>
              api.createTeam({ payload: { name: n.value, timeZone: z.value, leadEmail: e.value } }),
            );
          },
          (created) => {
            window.location.hash = teamHref(created.team.id);
          },
        );
      }}
    >
      <h2 className="text-xl font-semibold">{message("teams.create.title")}</h2>
      <TextField label={message("teams.create.name")} value={name} onChange={setName} />
      <TextField label={message("teams.create.timeZone")} value={timeZone} onChange={setTimeZone} />
      <TextField label={message("teams.create.leadEmail")} value={lead} onChange={setLead} type="email" />
      <Problem failure={failure} />
      <Button type="submit" disabled={busy} className={buttonClass}>
        {message("teams.create.action")}
      </Button>
    </Form>
  );
}

const listTeams = () => call((api) => api.listTeams());

/** The Teams list: every Team for an admin, otherwise the Teams the Person is in. */
export function TeamsScreen({ organizationAdmin }: { readonly organizationAdmin: boolean }) {
  const [view] = useView(listTeams);
  return (
    <section className="mt-6">
      <h2 className="text-xl font-semibold">{message("teams.title")}</h2>
      {view._tag === "Failed" ? <Problem failure={view.failure} /> : null}
      {view._tag === "Loaded" && view.value.length === 0 ? (
        <p className="mt-2 text-gray-600">{message("teams.empty")}</p>
      ) : null}
      {view._tag === "Loaded" ? (
        <ul className="mt-3 flex flex-col gap-2">
          {view.value.map((team) => (
            <li key={team.id}>
              <a href={teamHref(team.id)} className="flex justify-between rounded border px-3 py-2">
                <span>{team.name}</span>
                {team.yourRole === null ? null : (
                  <span className="text-sm text-gray-600">
                    {message("teams.yourRole", { role: roleName(team.yourRole) })}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {organizationAdmin ? <CreateTeam /> : null}
    </section>
  );
}

function RenameTeam({ detail, onChanged }: { readonly detail: TeamDetail; readonly onChanged: () => void }) {
  const [name, setName] = useState(detail.team.name);
  const [timeZone, setTimeZone] = useState<string>(detail.team.timeZone);
  const { busy, failure, change } = useChange();
  return (
    <Form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const n = decodeName(name.trim());
        const z = decodeZone(timeZone.trim());
        change(
          () =>
            Option.isNone(n) || Option.isNone(z)
              ? invalid()
              : call((api) =>
                  api.updateTeam({
                    params: { teamId: detail.team.id },
                    payload: { name: n.value, timeZone: z.value },
                  }),
                ),
          onChanged,
        );
      }}
    >
      <h3 className="text-lg font-medium">{message("team.rename.title")}</h3>
      <TextField label={message("teams.create.name")} value={name} onChange={setName} />
      <TextField label={message("teams.create.timeZone")} value={timeZone} onChange={setTimeZone} />
      <Problem failure={failure} />
      <Button type="submit" disabled={busy} className={buttonClass}>
        {message("team.rename.action")}
      </Button>
    </Form>
  );
}

function AddByEmail({
  label,
  action,
  add,
  onChanged,
}: {
  readonly label: string;
  readonly action: string;
  readonly add: (email: EmailAddress) => Promise<Outcome<unknown>>;
  readonly onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [added, setAdded] = useState(false);
  const { busy, failure, change } = useChange();
  return (
    <Form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = decodeEmail(email.trim());
        setAdded(false);
        change(
          () => (Option.isNone(parsed) ? invalid() : add(parsed.value)),
          () => {
            setEmail("");
            setAdded(true);
            onChanged();
          },
        );
      }}
    >
      <TextField label={label} value={email} onChange={setEmail} type="email" />
      <Problem failure={failure} />
      {added ? <p role="status">{message("team.added")}</p> : null}
      <Button type="submit" disabled={busy} className={buttonClass}>
        {action}
      </Button>
    </Form>
  );
}

function Roster({ detail, onChanged }: { readonly detail: TeamDetail; readonly onChanged: () => void }) {
  const { busy, failure, change } = useChange();
  const teamId = detail.team.id;
  return (
    <>
      <ul className="mt-2 flex flex-col gap-2">
        {detail.roster.map((entry) => {
          const isLead = entry.role === "lead";
          const mayRemove = isLead ? detail.may.manageLeads : detail.may.manageMembers;
          return (
            <li key={entry.personId} className="flex items-center justify-between rounded border px-3 py-2">
              <span>
                {entry.email} <span className="text-sm text-gray-600">{roleName(entry.role)}</span>{" "}
                <span className="text-sm text-gray-600">
                  {message("team.since", { date: formatDate(new Date(entry.since)) })}
                </span>
              </span>
              {mayRemove ? (
                <Button
                  disabled={busy}
                  className="text-sm underline"
                  onClick={() =>
                    change(
                      () =>
                        call((api) =>
                          isLead
                            ? api.removeLead({ params: { teamId, personId: entry.personId } })
                            : api.removeMember({ params: { teamId, personId: entry.personId } }),
                        ),
                      onChanged,
                    )
                  }
                >
                  {message(isLead ? "team.removeLead" : "team.removeMember")}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Problem failure={failure} />
    </>
  );
}

/** One Team: members and Leads, add by email, remove. Never any Results (ADR 0003). */
export function TeamScreen({ id }: { readonly id: TeamId }) {
  const load = useCallback(() => call((api) => api.getTeam({ params: { teamId: id } })), [id]);
  const [view, reload] = useView(load);
  return (
    <section className="mt-6">
      <a href="#/" className="text-sm underline">
        {message("team.back")}
      </a>
      {view._tag === "Failed" ? <Problem failure={view.failure} /> : null}
      {view._tag === "Loaded" ? (
        <>
          <h2 className="mt-2 text-xl font-semibold">{view.value.team.name}</h2>
          <p className="text-sm text-gray-600">
            {message("team.timeZone", { timeZone: view.value.team.timeZone })}
          </p>
          {view.value.team.yourRole === null ? (
            <p className="mt-2 text-sm text-gray-600">{message("team.noResultsAccess")}</p>
          ) : null}
          {view.value.may.managePulses ? (
            <a href={pulsesHref(id)} className="mt-4 inline-block underline">
              {message("team.pulses")}
            </a>
          ) : null}
          {view.value.may.update ? <RenameTeam detail={view.value} onChanged={reload} /> : null}
          <h3 className="mt-6 text-lg font-medium">{message("team.roster")}</h3>
          <Roster detail={view.value} onChanged={reload} />
          {view.value.may.manageMembers ? (
            <AddByEmail
              label={message("team.addMember.label")}
              action={message("team.addMember.action")}
              add={(email) => call((api) => api.addMember({ params: { teamId: id }, payload: { email } }))}
              onChanged={reload}
            />
          ) : null}
          {view.value.may.manageLeads ? (
            <AddByEmail
              label={message("team.assignLead.label")}
              action={message("team.assignLead.action")}
              add={(email) => call((api) => api.assignLead({ params: { teamId: id }, payload: { email } }))}
              onChanged={reload}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function MinimumGroupSizeForm({
  settings,
  onChanged,
}: {
  readonly settings: OrganizationSettings;
  readonly onChanged: () => void;
}) {
  const [size, setSize] = useState(String(settings.minimumGroupSize));
  const [saved, setSaved] = useState(false);
  const { busy, failure, change } = useChange();
  return (
    <Form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = decodeSize(Number(size));
        setSaved(false);
        change(
          () =>
            Option.isNone(parsed)
              ? invalid()
              : call((api) => api.updateSettings({ payload: { minimumGroupSize: parsed.value } })),
          () => {
            setSaved(true);
            onChanged();
          },
        );
      }}
    >
      <TextField label={message("settings.minimumGroupSize")} value={size} onChange={setSize} type="number" />
      <p className="text-sm text-gray-600">{message("settings.minimumGroupSize.help")}</p>
      <Problem failure={failure} />
      {saved ? <p role="status">{message("settings.saved")}</p> : null}
      <Button type="submit" disabled={busy} className={buttonClass}>
        {message("settings.save")}
      </Button>
    </Form>
  );
}

function People({
  settings,
  onChanged,
}: {
  readonly settings: OrganizationSettings;
  readonly onChanged: () => void;
}) {
  const { busy, failure, change } = useChange();
  const act = (run: () => Promise<Outcome<unknown>>) => change(run, onChanged);
  return (
    <>
      <h3 className="mt-6 text-lg font-medium">{message("settings.people")}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {settings.people.map((person) => {
          const personId = decodePerson(person.personId);
          return (
            <li key={person.personId} className="rounded border px-3 py-2">
              <p>
                {person.email}
                {person.organizationAdmin ? (
                  <span className="ml-2 text-sm text-gray-600">{message("settings.admin")}</span>
                ) : null}
                {person.linked ? null : (
                  <span className="ml-2 text-sm text-gray-600">{message("settings.notSignedInYet")}</span>
                )}
              </p>
              <div className="mt-1 flex gap-4 text-sm">
                <Button
                  disabled={busy}
                  className="underline"
                  onClick={() =>
                    act(() =>
                      call((api) =>
                        person.organizationAdmin
                          ? api.revokeAdmin({ params: { personId: person.personId } })
                          : api.grantAdmin({ params: { personId: person.personId } }),
                      ),
                    )
                  }
                >
                  {message(person.organizationAdmin ? "settings.revokeAdmin" : "settings.makeAdmin")}
                </Button>
                {Option.isSome(personId) ? (
                  <Button
                    disabled={busy}
                    className="underline"
                    onClick={() =>
                      act(() => call((api) => api.removePerson({ params: { personId: person.personId } })))
                    }
                  >
                    {message("settings.removePerson")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <Problem failure={failure} />
    </>
  );
}

const loadSettings = () => call((api) => api.getSettings());

/** Organization settings: N, and the People (admin role, removal). Organization admins only. */
export function SettingsScreen() {
  const [view, reload] = useView(loadSettings);
  return (
    <section className="mt-6">
      <h2 className="text-xl font-semibold">{message("settings.title")}</h2>
      {view._tag === "Failed" ? <Problem failure={view.failure} /> : null}
      {view._tag === "Loaded" ? (
        <>
          <MinimumGroupSizeForm settings={view.value} onChanged={reload} />
          <People settings={view.value} onChanged={reload} />
        </>
      ) : null}
    </section>
  );
}
