import {
  type PersonId,
  type PulseId,
  RoundId,
  RoundList,
  type RoundSummary,
  type TeamId,
} from "@surveybeat/domain";
import type { RoundDetail } from "@surveybeat/domain";
import { Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, message } from "../messages/index.ts";
import { Failure } from "./api.ts";
import { appButton, buttonClass, type Child, linkButton, problemView, textField } from "./components.ts";
import type { LoadedTeam } from "./directory.ts";
import { pulseHref, roundResultsHref } from "./routes.ts";

export const LoadedRounds = defineTaggedUnion({
  Loading: {},
  Loaded: { list: RoundList },
  Failed: { failure: Failure },
});
export type LoadedRounds = typeof LoadedRounds.Type;

/** A destructive Lead action waiting for the Lead to confirm it. */
export const RoundConfirm = Schema.Struct({
  kind: Schema.Literals(["close", "cancel"]),
  roundId: RoundId,
});
export type RoundConfirm = typeof RoundConfirm.Type;

/** Only a Team's Lead gets the controls and the Results link; an Organization admin sees the list only. */
export const isLead = (team: LoadedTeam): boolean =>
  team._tag === "Loaded" && team.detail.team.yourRole === "lead";

const dateText = (ms: number): string => formatDate(new Date(ms));

const roundDates = (round: RoundSummary): string =>
  message("rounds.dates", {
    from: dateText(round.openedAt ?? round.plannedOpenAt),
    to: dateText(round.closedAt ?? round.plannedCloseAt),
  });

const hasResults = (round: RoundSummary): boolean =>
  round.status === "closed" || round.status === "ready" || round.status === "shared";

export const roundsScreenView = <Message>(
  state: {
    readonly teamId: TeamId;
    readonly pulseId: PulseId;
    readonly team: LoadedTeam;
    readonly rounds: LoadedRounds;
    readonly details: Readonly<Record<string, RoundDetail>>;
    readonly rates: Readonly<Record<string, number | null>>;
    readonly confirm: RoundConfirm | undefined;
    readonly skipDate: string;
    readonly busy: boolean;
    readonly failure?: Failure | undefined;
  },
  actions: {
    readonly onSkipWeek: (plannedOpenDate: string) => Message;
    readonly onSkipDateChange: (date: string) => Message;
    readonly onSubmitSkipDate: Message;
    readonly onPause: Message;
    readonly onResume: Message;
    readonly onAskConfirm: (kind: RoundConfirm["kind"], roundId: RoundId) => Message;
    readonly onConfirm: Message;
    readonly onDismissConfirm: Message;
    readonly onResend: (roundId: RoundId, personId: PersonId) => Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [
    h.a(
      [h.Href(pulseHref(state.teamId, state.pulseId)), h.Class("text-sm underline")],
      [message("rounds.back")],
    ),
    h.h2([h.Class("mt-2 text-xl font-semibold")], [message("rounds.title")]),
  ];

  if (state.team._tag === "Failed") {
    children.push(problemView(state.team.failure, h)!);
    return h.section([h.Class("mt-6")], children);
  }
  if (state.rounds._tag === "Failed") {
    children.push(problemView(state.rounds.failure, h)!);
    return h.section([h.Class("mt-6")], children);
  }
  if (state.rounds._tag !== "Loaded") {
    return h.section([h.Class("mt-6")], children);
  }

  const lead = isLead(state.team);
  const { rounds } = state.rounds.list;

  if (lead) {
    children.push(
      h.div(
        [h.Class("mt-3 flex flex-col gap-2")],
        [
          h.p([h.Class("text-sm text-gray-600")], [message("rounds.pauseHelp")]),
          h.div(
            [h.Class("flex gap-4")],
            [
              appButton(
                {
                  text: message("rounds.pause"),
                  isDisabled: state.busy,
                  className: linkButton,
                  onClick: actions.onPause,
                },
                h,
              ),
              appButton(
                {
                  text: message("rounds.resume"),
                  isDisabled: state.busy,
                  className: linkButton,
                  onClick: actions.onResume,
                },
                h,
              ),
            ],
          ),
          h.form(
            [h.Class("flex flex-col gap-2"), h.OnSubmit(actions.onSubmitSkipDate)],
            [
              textField(
                {
                  id: "skip-date",
                  label: message("rounds.skipDate.label"),
                  value: state.skipDate,
                  isDisabled: state.busy,
                  onInput: actions.onSkipDateChange,
                },
                h,
              ),
              appButton(
                { text: message("rounds.skipDate.action"), type: "submit", isDisabled: state.busy },
                h,
              ),
            ],
          ),
        ],
      ),
    );
  }

  if (state.failure !== undefined) {
    children.push(problemView(state.failure, h)!);
  }

  if (rounds.length === 0) {
    children.push(h.p([h.Class("mt-3 text-gray-600")], [message("rounds.empty")]));
    return h.section([h.Class("mt-6")], children);
  }

  children.push(
    h.ul(
      [h.Class("mt-3 flex flex-col gap-3")],
      rounds.map((round) => {
        const detail = state.details[round.id];
        const rate = state.rates[round.id];
        const confirming = state.confirm?.roundId === round.id ? state.confirm.kind : undefined;
        const failed = lead ? (detail?.failedInvitations ?? []) : [];
        return h.li(
          [h.Class("flex flex-col gap-2 rounded border px-3 py-2")],
          [
            h.div(
              [h.Class("flex justify-between")],
              [
                h.span([], [message("rounds.round", { date: round.plannedOpenDate })]),
                h.span([h.Class("text-sm text-gray-600")], [message(`rounds.status.${round.status}`)]),
              ],
            ),
            h.p([h.Class("text-sm text-gray-600")], [roundDates(round)]),
            lead && hasResults(round) && rate !== undefined && rate !== null
              ? h.p(
                  [h.Class("text-sm text-gray-600")],
                  [message("rounds.responseRate", { rate: String(Math.round(rate * 100)) })],
                )
              : null,
            lead && hasResults(round)
              ? h.a(
                  [h.Href(roundResultsHref(state.teamId, round.id)), h.Class("text-sm underline")],
                  [message("rounds.viewResults")],
                )
              : null,
            lead && round.status === "scheduled"
              ? appButton(
                  {
                    text: message("rounds.skip"),
                    isDisabled: state.busy,
                    className: linkButton,
                    onClick: actions.onSkipWeek(round.plannedOpenDate),
                  },
                  h,
                )
              : null,
            lead && round.status === "open" && confirming === undefined
              ? h.div(
                  [h.Class("flex gap-4")],
                  [
                    appButton(
                      {
                        text: message("rounds.closeEarly"),
                        isDisabled: state.busy,
                        className: linkButton,
                        onClick: actions.onAskConfirm("close", round.id),
                      },
                      h,
                    ),
                    appButton(
                      {
                        text: message("rounds.cancel"),
                        isDisabled: state.busy,
                        className: linkButton,
                        onClick: actions.onAskConfirm("cancel", round.id),
                      },
                      h,
                    ),
                  ],
                )
              : null,
            confirming !== undefined
              ? h.div(
                  [h.Role("alertdialog"), h.Class("flex flex-col gap-2 rounded bg-amber-50 p-3")],
                  [
                    h.p([h.Class("text-sm text-amber-900")], [message(`rounds.confirm.${confirming}`)]),
                    h.div(
                      [h.Class("flex gap-4")],
                      [
                        appButton(
                          {
                            text: message("rounds.confirm.yes"),
                            isDisabled: state.busy,
                            className: buttonClass,
                            onClick: actions.onConfirm,
                          },
                          h,
                        ),
                        appButton(
                          {
                            text: message("rounds.confirm.no"),
                            isDisabled: state.busy,
                            className: linkButton,
                            onClick: actions.onDismissConfirm,
                          },
                          h,
                        ),
                      ],
                    ),
                  ],
                )
              : null,
            failed.length > 0
              ? h.div(
                  [h.Class("flex flex-col gap-1")],
                  [
                    h.h3([h.Class("text-sm font-medium")], [message("rounds.failedInvitations")]),
                    h.ul(
                      [h.Class("flex flex-col gap-1")],
                      failed.map((invitation) =>
                        h.li(
                          [h.Class("flex items-center justify-between text-sm")],
                          [
                            h.span(
                              [],
                              [
                                message("rounds.failedInvitation", {
                                  email: invitation.email,
                                  reason: invitation.reason,
                                }),
                              ],
                            ),
                            appButton(
                              {
                                text: message("rounds.resend"),
                                isDisabled: state.busy,
                                className: linkButton,
                                onClick: actions.onResend(round.id, invitation.personId),
                              },
                              h,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                )
              : null,
          ].filter(Predicate.isNotNull),
        );
      }),
    ),
  );

  return h.section([h.Class("mt-6")], children);
};
