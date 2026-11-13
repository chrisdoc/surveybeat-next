import {
  type PersonId,
  type PulseId,
  RoundId,
  RoundList,
  type RoundStatus,
  type RoundSummary,
  type TeamId,
} from "@surveybeat/domain";
import type { RoundDetail } from "@surveybeat/domain";
import { Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, formatPercent, formatRoundDate, message } from "../messages/locale.ts";
import { Failure } from "./api.ts";
import {
  appButton,
  badge,
  type BadgeVariant,
  type Child,
  emptyState,
  confirmDialog,
  linkButton,
  linkClass,
  pageTitle,
  problemView,
  secondaryButtonClass,
  textField,
  breadcrumbs,
} from "./components.ts";
import type { LoadedTeam } from "./directory.ts";
import { pulseHref, roundResultsHref, teamHref } from "./routes.ts";

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

/** A Round's status colour: open now, ready to share, closed, shared, cancelled. */
const statusVariant = (status: RoundStatus): BadgeVariant =>
  status === "open"
    ? "primary"
    : status === "ready"
      ? "brass"
      : status === "shared"
        ? "success"
        : status === "cancelled"
          ? "danger"
          : "neutral";

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
    readonly skipOpen: boolean;
    readonly busy: boolean;
    readonly failure?: Failure | undefined;
  },
  actions: {
    readonly onSkipWeek: (plannedOpenDate: string) => Message;
    readonly onSkipDateChange: (date: string) => Message;
    readonly onSubmitSkipDate: Message;
    readonly onToggleSkip: Message;
    readonly onPause: Message;
    readonly onResume: Message;
    readonly onAskConfirm: (kind: RoundConfirm["kind"], roundId: RoundId) => Message;
    readonly onConfirm: Message;
    readonly onDismissConfirm: Message;
    readonly onResend: (roundId: RoundId, personId: PersonId) => Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const teamName = state.team._tag === "Loaded" ? state.team.detail.team.name : message("title.team");
  const pulseName =
    state.rounds._tag === "Loaded"
      ? (state.rounds.list.rounds[0]?.pulseName ?? message("title.pulse"))
      : message("title.pulse");
  const children: Array<Child> = [
    breadcrumbs(
      [
        { label: teamName, href: teamHref(state.teamId) },
        { label: pulseName, href: pulseHref(state.teamId, state.pulseId) },
        { label: message("rounds.title") },
      ],
      h,
    ),
    h.div([h.Class("mt-4")], [pageTitle(message("rounds.title"), h)]),
  ];

  if (state.team._tag === "Failed") {
    children.push(problemView(state.team.failure, h)!);
    return h.section([], children);
  }
  if (state.rounds._tag === "Failed") {
    children.push(problemView(state.rounds.failure, h)!);
    return h.section([], children);
  }
  if (state.rounds._tag !== "Loaded") {
    return h.section([], children);
  }

  const lead = isLead(state.team);
  const { rounds } = state.rounds.list;

  if (lead) {
    const { paused } = state.rounds.list;
    children.push(
      h.div(
        [h.Class("mt-6 flex flex-col gap-3")],
        [
          h.p([h.Class("font-medium")], [message(paused ? "rounds.status.paused" : "rounds.status.active")]),
          paused ? null : h.p([h.Class("text-muted")], [message("rounds.pauseHelp")]),
          h.div(
            [h.Class("flex gap-4")],
            [
              paused
                ? appButton(
                    {
                      text: message("rounds.resume"),
                      isDisabled: state.busy,
                      className: linkButton,
                      onClick: actions.onResume,
                    },
                    h,
                  )
                : appButton(
                    {
                      text: message("rounds.pause"),
                      isDisabled: state.busy,
                      className: linkButton,
                      onClick: actions.onPause,
                    },
                    h,
                  ),
            ],
          ),
          state.skipOpen
            ? null
            : appButton(
                {
                  text: message("rounds.skipDate.open"),
                  isDisabled: state.busy,
                  className: secondaryButtonClass,
                  onClick: actions.onToggleSkip,
                },
                h,
              ),
          state.skipOpen
            ? h.form(
                [
                  h.Class("flex flex-col gap-4 rounded-panel border border-line bg-surface p-6"),
                  h.OnSubmit(actions.onSubmitSkipDate),
                ],
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
                  h.div(
                    [h.Class("flex flex-wrap gap-3")],
                    [
                      appButton(
                        {
                          text: message("rounds.skipDate.action"),
                          type: "submit",
                          isDisabled: state.busy,
                        },
                        h,
                      ),
                      appButton(
                        {
                          text: message("confirm.cancel"),
                          onClick: actions.onToggleSkip,
                          className: secondaryButtonClass,
                        },
                        h,
                      ),
                    ],
                  ),
                ],
              )
            : null,
        ].filter(Predicate.isNotNull),
      ),
    );
  }

  if (state.failure !== undefined) {
    children.push(problemView(state.failure, h)!);
  }

  if (rounds.length === 0) {
    children.push(emptyState({ title: message("rounds.empty.title"), body: message("rounds.empty") }, h));
    return h.section([], children);
  }

  children.push(
    h.ul(
      [h.Class("mt-8 flex flex-col gap-3")],
      rounds.map((round) => {
        const detail = state.details[round.id];
        const rate = state.rates[round.id];
        const confirming = state.confirm?.roundId === round.id ? state.confirm.kind : undefined;
        const failed = lead ? (detail?.failedInvitations ?? []) : [];
        return h.li(
          [h.Class("flex flex-col gap-2 rounded-panel border border-line bg-surface px-6 py-4")],
          [
            h.div(
              [h.Class("flex items-center justify-between gap-4")],
              [
                h.span(
                  [h.Class("font-semibold")],
                  [message("rounds.round", { date: formatRoundDate(round.plannedOpenDate) })],
                ),
                badge(statusVariant(round.status), [message(`rounds.status.${round.status}`)], h),
              ],
            ),
            h.p([h.Class("text-sm text-muted")], [roundDates(round)]),
            lead && hasResults(round) && rate !== undefined && rate !== null
              ? h.p(
                  [h.Class("text-sm text-muted")],
                  [message("rounds.responseRate", { rate: formatPercent(rate) })],
                )
              : null,
            lead && round.status === "ready"
              ? h.a(
                  [
                    h.Href(roundResultsHref(state.teamId, round.id)),
                    h.Class(
                      "inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-sm font-semibold text-on-primary hover:opacity-90",
                    ),
                  ],
                  [message("rounds.reviewShare")],
                )
              : null,
            lead && hasResults(round) && round.status !== "ready"
              ? h.a(
                  [
                    h.Href(roundResultsHref(state.teamId, round.id)),
                    h.Class(`inline-flex min-h-11 items-center ${linkClass}`),
                  ],
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
              ? confirmDialog(
                  {
                    title: message(confirming === "cancel" ? "rounds.cancel" : "rounds.closeEarly"),
                    body: message(`rounds.confirm.${confirming}`),
                    confirmText: message("rounds.confirm.yes"),
                    cancelText: message("rounds.confirm.no"),
                    isBusy: state.busy,
                    onConfirm: actions.onConfirm,
                    onCancel: actions.onDismissConfirm,
                  },
                  h,
                )
              : null,
            failed.length > 0
              ? h.div(
                  [h.Class("flex flex-col gap-1")],
                  [
                    h.h2([h.Class("text-sm font-semibold")], [message("rounds.failedInvitations")]),
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

  return h.section([], children);
};
