import * as DateTime from "effect/DateTime";
import {
  ActionId,
  ActionStatus,
  Dimension,
  EmailAddress,
  MinimumGroupSize,
  NewPulseQuestion,
  OrganizationId,
  PersonId,
  PulseId,
  PulseSettings,
  QuestionContent,
  QuestionId,
  RoundId,
  SendId,
  TeamId,
  TeamName,
  TimeZone,
} from "@surveybeat/domain";
import { Effect, Schema } from "effect";
import { Command, Navigation } from "foldkit";
import type { Model } from "./appModel.ts";
import { Message } from "./appModel.ts";
import { runApi } from "./api.ts";
import type { FailedEmailResend } from "./directory.ts";
import { FAILED_EMAIL_POLL_INTERVAL } from "./directory.ts";
import { browserStorage, clearKeptAnswers, clearOwnBrowserData, readKeptAnswers } from "./keptAnswers.ts";
import {
  authenticateWithPasskey,
  deleteUserPasskey,
  detectPasskeyCapabilities,
  listUserPasskeys,
  registerPasskey,
  renameUserPasskey,
} from "./passkeyClient.ts";
import { TEST_SEND_POLL_INTERVAL } from "./pulses.ts";
import type { AppRoute } from "./routes.ts";
import { runSessionCall } from "./session.ts";

export const LoadSession = Command.define("LoadSession", {
  messages: [Message.GotSession],
  execute: Effect.suspend(() =>
    runSessionCall((api) => api.auth.session()).pipe(Effect.map((result) => Message.GotSession({ result }))),
  ),
});

export const DetectPasskeyCapabilities = Command.define("DetectPasskeyCapabilities", {
  messages: [Message.GotPasskeyCapabilities],
  execute: Effect.suspend(() =>
    detectPasskeyCapabilities.pipe(
      Effect.map((capabilities) => Message.GotPasskeyCapabilities({ capabilities })),
    ),
  ),
});

export const SignInWithPasskey = Command.define("SignInWithPasskey", {
  messages: [Message.PasskeySignedIn],
  execute: Effect.suspend(() =>
    authenticateWithPasskey({ conditional: false }).pipe(
      Effect.map((outcome) => Message.PasskeySignedIn({ verified: outcome._tag === "Verified" })),
    ),
  ),
});

export const ListPasskeysCmd = Command.define("ListPasskeysCmd", {
  messages: [Message.GotPasskeys],
  execute: Effect.suspend(() =>
    listUserPasskeys.pipe(
      Effect.map((outcome) =>
        outcome._tag === "Success"
          ? Message.GotPasskeys({ outcome: { _tag: "Success", passkeys: [...outcome.passkeys] } })
          : Message.GotPasskeys({ outcome: { _tag: "Failure", failure: outcome.failure } }),
      ),
    ),
  ),
});

export const AddPasskeyCmd = Command.define("AddPasskeyCmd", {
  messages: [Message.AddedPasskey],
  execute: Effect.suspend(() =>
    registerPasskey().pipe(
      Effect.map((outcome) => {
        if (outcome._tag === "Success") {
          return Message.AddedPasskey({ cancelled: false, outcome: { _tag: "Success" } });
        }

        if (outcome._tag === "Cancelled") {
          return Message.AddedPasskey({ cancelled: true, outcome: { _tag: "Success" } });
        }

        return Message.AddedPasskey({
          cancelled: false,
          outcome: { _tag: "Failure", failure: outcome.failure },
        });
      }),
    ),
  ),
});

export const RenamePasskeyCmd = Command.define("RenamePasskeyCmd", {
  args: { id: Schema.String, name: Schema.String },
  messages: [Message.PasskeyRenamed],
  execute: ({ id, name }) =>
    renameUserPasskey(id, name).pipe(
      Effect.map((outcome) =>
        outcome._tag === "Success"
          ? Message.PasskeyRenamed({ outcome: { _tag: "Success" } })
          : Message.PasskeyRenamed({ outcome: { _tag: "Failure", failure: outcome.failure } }),
      ),
    ),
});

export const DeletePasskeyCmd = Command.define("DeletePasskeyCmd", {
  args: { id: Schema.String },
  messages: [Message.PasskeyDeleted],
  execute: ({ id }) =>
    deleteUserPasskey(id).pipe(
      Effect.map((outcome) =>
        outcome._tag === "Success"
          ? Message.PasskeyDeleted({ outcome: { _tag: "Success" } })
          : Message.PasskeyDeleted({ outcome: { _tag: "Failure", failure: outcome.failure } }),
      ),
    ),
});

export const SendSignInCode = Command.define("SendSignInCode", {
  args: { email: EmailAddress },
  messages: [Message.SignInCodeSent],
  execute: ({ email }) =>
    runApi(
      (api) => api.auth.sendSignInCode({ payload: { email } }),
      () => Message.SignInCodeSent({ sent: true }),
      () => Message.SignInCodeSent({ sent: false }),
    ),
});

export const VerifySignInCode = Command.define("VerifySignInCode", {
  args: { email: EmailAddress, code: Schema.String },
  messages: [Message.SignInCodeChecked],
  execute: ({ email, code }) =>
    runApi(
      (api) => api.auth.verifySignInCode({ payload: { email, code } }),
      (result) => Message.SignInCodeChecked({ verified: result.verified }),
      () => Message.SignInCodeChecked({ verified: false }),
    ),
});

export const CreateOrganization = Command.define("CreateOrganization", {
  args: { name: Schema.String },
  messages: [Message.GotSession],
  execute: ({ name }) =>
    runSessionCall((api) => api.auth.createOrganization({ payload: { name } })).pipe(
      Effect.map((result) => Message.GotSession({ result })),
    ),
});

export const ChooseOrganization = Command.define("ChooseOrganization", {
  args: { organizationId: OrganizationId },
  messages: [Message.GotSession],
  execute: ({ organizationId }) =>
    runSessionCall((api) => api.auth.chooseOrganization({ payload: { organizationId } })).pipe(
      Effect.map((result) => Message.GotSession({ result })),
    ),
});

export const ListTeams = Command.define("ListTeams", {
  messages: [Message.GotTeams],
  execute: Effect.suspend(() =>
    runApi(
      (api) => api.directory.listTeams(),
      (teams) => Message.GotTeams({ outcome: { _tag: "Success", teams } }),
      (failure) => Message.GotTeams({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const CreateTeam = Command.define("CreateTeam", {
  args: { name: TeamName, timeZone: TimeZone, leadEmail: EmailAddress },
  messages: [Message.CreatedTeam],
  execute: ({ name, timeZone, leadEmail }) =>
    runApi(
      (api) => api.directory.createTeam({ payload: { name, timeZone, leadEmail } }),
      (detail) => Message.CreatedTeam({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.CreatedTeam({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetTeam = Command.define("GetTeam", {
  args: { teamId: TeamId },
  messages: [Message.GotTeam],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.directory.getTeam({ params: { teamId } }),
      (detail) => Message.GotTeam({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.GotTeam({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetTeamOverviewCmd = Command.define("GetTeamOverviewCmd", {
  args: { teamId: TeamId },
  messages: [Message.GotTeamOverview],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.rounds.getTeamOverview({ params: { teamId } }),
      (overview) => Message.GotTeamOverview({ outcome: { _tag: "Success", overview } }),
      (failure) => Message.GotTeamOverview({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateTeam = Command.define("UpdateTeam", {
  args: { teamId: TeamId, name: TeamName, timeZone: TimeZone },
  messages: [Message.UpdatedTeam],
  execute: ({ teamId, name, timeZone }) =>
    runApi(
      (api) => api.directory.updateTeam({ params: { teamId }, payload: { name, timeZone } }),
      () => Message.UpdatedTeam({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedTeam({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const AddMember = Command.define("AddMember", {
  args: { teamId: TeamId, email: EmailAddress },
  messages: [Message.AddedMember],
  execute: ({ teamId, email }) =>
    runApi(
      (api) => api.directory.addMember({ params: { teamId }, payload: { email } }),
      () => Message.AddedMember({ outcome: { _tag: "Success" } }),
      (failure) => Message.AddedMember({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const AssignLead = Command.define("AssignLead", {
  args: { teamId: TeamId, email: EmailAddress },
  messages: [Message.AssignedLead],
  execute: ({ teamId, email }) =>
    runApi(
      (api) => api.directory.assignLead({ params: { teamId }, payload: { email } }),
      () => Message.AssignedLead({ outcome: { _tag: "Success" } }),
      (failure) => Message.AssignedLead({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemoveMember = Command.define("RemoveMember", {
  args: { teamId: TeamId, personId: PersonId },
  messages: [Message.RemovedMember],
  execute: ({ teamId, personId }) =>
    runApi(
      (api) => api.directory.removeMember({ params: { teamId, personId } }),
      () => Message.RemovedMember({ outcome: { _tag: "Success" } }),
      (failure) => Message.RemovedMember({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemoveLead = Command.define("RemoveLead", {
  args: { teamId: TeamId, personId: PersonId },
  messages: [Message.RemovedLead],
  execute: ({ teamId, personId }) =>
    runApi(
      (api) => api.directory.removeLead({ params: { teamId, personId } }),
      () => Message.RemovedLead({ outcome: { _tag: "Success" } }),
      (failure) => Message.RemovedLead({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetSettings = Command.define("GetSettings", {
  messages: [Message.GotSettings],
  execute: Effect.suspend(() =>
    runApi(
      (api) => api.directory.getSettings(),
      (settings) => Message.GotSettings({ outcome: { _tag: "Success", settings } }),
      (failure) => Message.GotSettings({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const ListFailedEmails = Command.define("ListFailedEmails", {
  messages: [Message.GotFailedEmails],
  execute: Effect.suspend(() =>
    runApi(
      (api) => api.directory.listFailedEmails(),
      (list) => Message.GotFailedEmails({ outcome: { _tag: "Success", list } }),
      (failure) => Message.GotFailedEmails({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const ResendFailedEmailCmd = Command.define("ResendFailedEmailCmd", {
  args: { sendId: SendId },
  messages: [Message.ResentFailedEmail],
  execute: ({ sendId }) =>
    runApi(
      (api) => api.directory.resendFailedEmail({ params: { sendId } }),
      (status) => Message.ResentFailedEmail({ sendId, outcome: { _tag: "Success", status } }),
      (failure) => Message.ResentFailedEmail({ sendId, outcome: { _tag: "Failure", failure } }),
    ),
});

export const PollFailedEmailCmd = Command.define("PollFailedEmailCmd", {
  args: { sendId: SendId },
  messages: [Message.PolledFailedEmail],
  execute: ({ sendId }) =>
    Effect.sleep(FAILED_EMAIL_POLL_INTERVAL).pipe(
      Effect.andThen(
        runApi(
          (api) => api.directory.getEmailStatus({ params: { sendId } }),
          (status) => Message.PolledFailedEmail({ sendId, outcome: { _tag: "Success", status } }),
          (failure) => Message.PolledFailedEmail({ sendId, outcome: { _tag: "Failure", failure } }),
        ),
      ),
    ),
});

export const withFailedEmailResend = (model: Model, sendId: SendId, resend: FailedEmailResend): Model => ({
  ...model,
  failedEmailResends: { ...model.failedEmailResends, [sendId]: resend },
});

export const UpdateSettings = Command.define("UpdateSettings", {
  args: { minimumGroupSize: MinimumGroupSize },
  messages: [Message.UpdatedSettings],
  execute: ({ minimumGroupSize }) =>
    runApi(
      (api) => api.directory.updateSettings({ payload: { minimumGroupSize } }),
      () => Message.UpdatedSettings({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedSettings({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateAiProcessing = Command.define("UpdateAiProcessing", {
  args: { aiProcessing: Schema.Boolean },
  messages: [Message.UpdatedAiProcessing],
  execute: ({ aiProcessing }) =>
    runApi(
      (api) => api.directory.updateSettings({ payload: { aiProcessing } }),
      () => Message.UpdatedAiProcessing({ outcome: { _tag: "Success" } }),
      (failure) => Message.UpdatedAiProcessing({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GrantAdmin = Command.define("GrantAdmin", {
  args: { personId: PersonId },
  messages: [Message.GrantedAdmin],
  execute: ({ personId }) =>
    runApi(
      (api) => api.directory.grantAdmin({ params: { personId } }),
      () => Message.GrantedAdmin({ outcome: { _tag: "Success" } }),
      (failure) => Message.GrantedAdmin({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RevokeAdmin = Command.define("RevokeAdmin", {
  args: { personId: PersonId },
  messages: [Message.RevokedAdmin],
  execute: ({ personId }) =>
    runApi(
      (api) => api.directory.revokeAdmin({ params: { personId } }),
      () => Message.RevokedAdmin({ outcome: { _tag: "Success" } }),
      (failure) => Message.RevokedAdmin({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemovePerson = Command.define("RemovePerson", {
  args: { personId: PersonId },
  messages: [Message.RemovedPerson],
  execute: ({ personId }) =>
    runApi(
      (api) => api.directory.removePerson({ params: { personId } }),
      () => Message.RemovedPerson({ outcome: { _tag: "Success" } }),
      (failure) => Message.RemovedPerson({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ErasePersonData = Command.define("ErasePersonData", {
  args: { personId: PersonId, confirmation: EmailAddress },
  messages: [Message.ErasedPerson],
  execute: ({ personId, confirmation }) =>
    runApi(
      (api) => api.directory.erasePerson({ params: { personId }, payload: { confirmation } }),
      () => Message.ErasedPerson({ outcome: { _tag: "Success" } }),
      (failure) => Message.ErasedPerson({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const EraseOwnPersonData = Command.define("EraseOwnPersonData", {
  args: { confirmation: EmailAddress },
  messages: [Message.SelfErased],
  execute: ({ confirmation }) =>
    runApi(
      (api) => api.me.erasePerson({ payload: { confirmation } }),
      () => Message.SelfErased({ outcome: { _tag: "Success" } }),
      (failure) => Message.SelfErased({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const EraseOwnAccountData = Command.define("EraseOwnAccountData", {
  args: { confirmation: EmailAddress },
  messages: [Message.SelfErased],
  execute: ({ confirmation }) =>
    runApi(
      (api) => api.me.eraseAccount({ payload: { confirmation } }),
      () => Message.SelfErased({ outcome: { _tag: "Success" } }),
      (failure) => Message.SelfErased({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RequestEmailChange = Command.define("RequestEmailChange", {
  args: { email: Schema.String },
  messages: [Message.EmailChangeCodeSent],
  execute: ({ email }) =>
    runApi(
      (api) => api.me.requestEmailChange({ payload: { email } }),
      () => Message.EmailChangeCodeSent({ outcome: { _tag: "Success" } }),
      (failure) => Message.EmailChangeCodeSent({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ConfirmEmailChange = Command.define("ConfirmEmailChange", {
  args: { email: Schema.String, otp: Schema.String },
  messages: [Message.EmailChangeFinished],
  execute: ({ email, otp }) =>
    runApi(
      (api) => api.me.confirmEmailChange({ payload: { email, otp } }),
      () => Message.EmailChangeFinished({ outcome: { _tag: "Success" } }),
      (failure) => Message.EmailChangeFinished({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CorrectPersonEmail = Command.define("CorrectPersonEmail", {
  args: { personId: PersonId, email: Schema.String },
  messages: [Message.CorrectedEmail],
  execute: ({ personId, email }) =>
    runApi(
      (api) => api.directory.correctPersonEmail({ params: { personId }, payload: { email } }),
      () => Message.CorrectedEmail({ outcome: { _tag: "Success" } }),
      (failure) => Message.CorrectedEmail({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const OffboardOrganization = Command.define("OffboardOrganization", {
  args: { confirmation: Schema.String },
  messages: [Message.OffboardedOrganization],
  execute: ({ confirmation }) =>
    runApi(
      (api) => api.directory.offboardOrganization({ payload: { confirmation } }),
      () => Message.OffboardedOrganization({ outcome: { _tag: "Success" } }),
      (failure) =>
        Message.OffboardedOrganization({
          outcome: {
            _tag: "Failure",
            failure: failure === "ErasureNotConfirmed" ? "OrganizationNotConfirmed" : failure,
          },
        }),
    ),
});

export const LeaveAfterErasureCmd = Command.define("LeaveAfterErasureCmd", {
  messages: [Message.LeftAfterErasure],
  execute: Effect.sync(() => {
    const storage = browserStorage();

    if (storage !== null) {
      clearOwnBrowserData(storage);
    }

    window.location.assign("/");

    return Message.LeftAfterErasure();
  }),
});

export const ListPulses = Command.define("ListPulses", {
  args: { teamId: TeamId },
  messages: [Message.GotPulses],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.pulses.listPulses({ params: { teamId } }),
      (pulses) => Message.GotPulses({ outcome: { _tag: "Success", pulses } }),
      (failure) => Message.GotPulses({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CreatePulse = Command.define("CreatePulse", {
  args: { teamId: TeamId },
  messages: [Message.CreatedPulse],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.pulses.createPulse({ params: { teamId } }),
      (detail) => Message.CreatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.CreatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetPulse = Command.define("GetPulse", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.GotPulse],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.pulses.getPulse({ params: { teamId, pulseId } }),
      (detail) => Message.GotPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.GotPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdatePulseSettingsCmd = Command.define("UpdatePulseSettingsCmd", {
  args: { teamId: TeamId, pulseId: PulseId, settings: PulseSettings },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, settings }) =>
    runApi(
      (api) => api.pulses.updatePulseSettings({ params: { teamId, pulseId }, payload: settings }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const SendTestInvitationCmd = Command.define("SendTestInvitationCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.SentTestInvitation],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.pulses.sendTestInvitation({ params: { teamId, pulseId } }),
      (sent) =>
        Message.SentTestInvitation({
          outcome: { _tag: "Success", email: sent.email, sendId: sent.sendId, pulseId },
        }),
      (failure) => Message.SentTestInvitation({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const PollTestSendCmd = Command.define("PollTestSendCmd", {
  args: { teamId: TeamId, pulseId: PulseId, sendId: SendId },
  messages: [Message.PolledTestSend],
  execute: ({ teamId, pulseId, sendId }) =>
    Effect.sleep(TEST_SEND_POLL_INTERVAL).pipe(
      Effect.andThen(
        runApi(
          (api) => api.pulses.getTestInvitation({ params: { teamId, pulseId, sendId } }),
          (status) => Message.PolledTestSend({ sendId, outcome: { _tag: "Success", status } }),
          (failure) => Message.PolledTestSend({ sendId, outcome: { _tag: "Failure", failure } }),
        ),
      ),
    ),
});

export const AddQuestionCmd = Command.define("AddQuestionCmd", {
  args: { teamId: TeamId, pulseId: PulseId, payload: NewPulseQuestion },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, payload }) =>
    runApi(
      (api) =>
        api.pulses.addQuestion({
          params: { teamId, pulseId },
          payload,
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const EditQuestionCmd = Command.define("EditQuestionCmd", {
  args: { teamId: TeamId, pulseId: PulseId, questionId: QuestionId, payload: QuestionContent },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, questionId, payload }) =>
    runApi(
      (api) =>
        api.pulses.editQuestion({
          params: { teamId, pulseId, questionId },
          payload,
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RemoveQuestionCmd = Command.define("RemoveQuestionCmd", {
  args: { teamId: TeamId, pulseId: PulseId, questionId: QuestionId },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, questionId }) =>
    runApi(
      (api) =>
        api.pulses.removeQuestion({
          params: { teamId, pulseId, questionId },
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ReorderQuestionsCmd = Command.define("ReorderQuestionsCmd", {
  args: { teamId: TeamId, pulseId: PulseId, order: Schema.Array(QuestionId) },
  messages: [Message.UpdatedPulse],
  execute: ({ teamId, pulseId, order }) =>
    runApi(
      (api) =>
        api.pulses.reorderQuestions({
          params: { teamId, pulseId },
          payload: { order: [...order] },
        }),
      (detail) => Message.UpdatedPulse({ outcome: { _tag: "Success", detail } }),
      (failure) => Message.UpdatedPulse({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ListRoundsCmd = Command.define("ListRoundsCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.GotRounds],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.rounds.listRounds({ params: { teamId, pulseId } }),
      (list) => Message.GotRounds({ outcome: { _tag: "Success", list } }),
      (failure) => Message.GotRounds({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetRoundDetailCmd = Command.define("GetRoundDetailCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotRoundDetail],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.getRound({ params: { teamId, roundId } }),
      (detail) => Message.GotRoundDetail({ roundId, outcome: { _tag: "Success", detail } }),
      (failure) => Message.GotRoundDetail({ roundId, outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetRoundRateCmd = Command.define("GetRoundRateCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotRoundRate],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.getResults({ params: { teamId, roundId } }),
      (result) => Message.GotRoundRate({ roundId, outcome: { _tag: "Success", result } }),
      (failure) => Message.GotRoundRate({ roundId, outcome: { _tag: "Failure", failure } }),
    ),
});

export const SkipWeekCmd = Command.define("SkipWeekCmd", {
  args: { teamId: TeamId, pulseId: PulseId, plannedOpenDate: Schema.String },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, pulseId, plannedOpenDate }) =>
    runApi(
      (api) => api.rounds.skipWeek({ params: { teamId, pulseId }, payload: { plannedOpenDate } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const PausePulseCmd = Command.define("PausePulseCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.rounds.pausePulse({ params: { teamId, pulseId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ResumePulseCmd = Command.define("ResumePulseCmd", {
  args: { teamId: TeamId, pulseId: PulseId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, pulseId }) =>
    runApi(
      (api) => api.rounds.resumePulse({ params: { teamId, pulseId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CloseRoundEarlyCmd = Command.define("CloseRoundEarlyCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.closeRoundEarly({ params: { teamId, roundId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CancelRoundCmd = Command.define("CancelRoundCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.cancelRound({ params: { teamId, roundId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ResendInvitationCmd = Command.define("ResendInvitationCmd", {
  args: { teamId: TeamId, roundId: RoundId, personId: PersonId },
  messages: [Message.RoundCommandDone],
  execute: ({ teamId, roundId, personId }) =>
    runApi(
      (api) => api.rounds.resendInvitation({ params: { teamId, roundId, personId } }),
      () => Message.RoundCommandDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RoundCommandDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetResultsCmd = Command.define("GetResultsCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotResults],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.getResults({ params: { teamId, roundId } }),
      (result) => Message.GotResults({ outcome: { _tag: "Success", result } }),
      (failure) => Message.GotResults({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetMyHistoryCmd = Command.define("GetMyHistoryCmd", {
  messages: [Message.GotMyHistory],
  execute: Effect.flatMap(DateTime.now, (now) =>
    runApi(
      (api) => api.rounds.getMyHistory({}),
      (history) => {
        const storage = browserStorage();
        const kept = storage === null ? {} : readKeptAnswers(storage, DateTime.toEpochMillis(now));

        return Message.GotMyHistory({ outcome: { _tag: "Success", history, kept } });
      },
      (failure) => Message.GotMyHistory({ outcome: { _tag: "Failure", failure } }),
    ),
  ),
});

export const ClearKeptAnswersCmd = Command.define("ClearKeptAnswersCmd", {
  messages: [Message.ClearedKeptAnswers],
  execute: Effect.sync(() => {
    const storage = browserStorage();

    if (storage !== null) {
      clearKeptAnswers(storage);
    }

    return Message.ClearedKeptAnswers();
  }),
});

export const CopyGuideTextCmd = Command.define("CopyGuideTextCmd", {
  args: { text: Schema.String },
  messages: [Message.CopiedGuide],
  execute: ({ text }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: (): "copyFailed" => "copyFailed",
    }).pipe(
      Effect.match({
        onSuccess: () => Message.CopiedGuide({ ok: true }),
        onFailure: () => Message.CopiedGuide({ ok: false }),
      }),
    ),
});

export const ShareResultsCmd = Command.define("ShareResultsCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.ResultsShareDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.shareResults({ params: { teamId, roundId } }),
      () => Message.ResultsShareDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.ResultsShareDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const RetryResultCmd = Command.define("RetryResultCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.RetryResultDone],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.rounds.retryResult({ params: { teamId, roundId } }),
      () => Message.RetryResultDone({ outcome: { _tag: "Success" } }),
      (failure) => Message.RetryResultDone({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const ListActionsCmd = Command.define("ListActionsCmd", {
  args: { teamId: TeamId },
  messages: [Message.GotActions],
  execute: ({ teamId }) =>
    runApi(
      (api) => api.actions.listActions({ params: { teamId } }),
      (list) => Message.GotActions({ outcome: { _tag: "Success", list } }),
      (failure) => Message.GotActions({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const CreateActionCmd = Command.define("CreateActionCmd", {
  args: {
    teamId: TeamId,
    roundId: RoundId,
    title: Schema.String,
    ownerId: PersonId,
    dueDate: Schema.NullOr(Schema.String),
    dimension: Schema.NullOr(Dimension),
  },
  messages: [Message.CreatedAction],
  execute: ({ teamId, roundId, title, ownerId, dueDate, dimension }) =>
    runApi(
      (api) =>
        api.actions.createAction({
          params: { teamId },
          payload: { roundId, title, ownerId, dueDate, dimension },
        }),
      (action) => Message.CreatedAction({ outcome: { _tag: "Success", action } }),
      (failure) => Message.CreatedAction({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const UpdateActionCmd = Command.define("UpdateActionCmd", {
  args: {
    teamId: TeamId,
    actionId: ActionId,
    status: ActionStatus,
  },
  messages: [Message.UpdatedAction],
  execute: ({ teamId, actionId, status }) =>
    runApi(
      (api) =>
        api.actions.updateAction({
          params: { teamId, actionId },
          payload: { status },
        }),
      (action) => Message.UpdatedAction({ outcome: { _tag: "Success", action } }),
      (failure) => Message.UpdatedAction({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const GetRoundNoteCmd = Command.define("GetRoundNoteCmd", {
  args: { teamId: TeamId, roundId: RoundId },
  messages: [Message.GotRoundNote],
  execute: ({ teamId, roundId }) =>
    runApi(
      (api) => api.notes.getRoundNote({ params: { teamId, roundId } }),
      (view) => Message.GotRoundNote({ outcome: { _tag: "Success", view } }),
      (failure) => Message.GotRoundNote({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const SaveRoundNoteCmd = Command.define("SaveRoundNoteCmd", {
  args: { teamId: TeamId, roundId: RoundId, text: Schema.String },
  messages: [Message.SavedNote],
  execute: ({ teamId, roundId, text }) =>
    runApi(
      (api) => api.notes.saveRoundNote({ params: { teamId, roundId }, payload: { text } }),
      (view) => Message.SavedNote({ outcome: { _tag: "Success", view } }),
      (failure) => Message.SavedNote({ outcome: { _tag: "Failure", failure } }),
    ),
});

export const Navigate = Command.define("Navigate", {
  args: { url: Schema.String },
  messages: [Message.Navigated],
  execute: ({ url }) => Navigation.pushUrl(url).pipe(Effect.as(Message.Navigated())),
});

export const LoadExternalUrl = Command.define("LoadExternalUrl", {
  args: { href: Schema.String },
  messages: [Message.Navigated],
  execute: ({ href }) => Navigation.load(href).pipe(Effect.as(Message.Navigated())),
});

export const loadActiveRouteCommand = (route: AppRoute) => {
  switch (route._tag) {
    case "Teams": {
      return [ListTeams()];
    }

    case "Team": {
      return [
        GetTeam({ teamId: route.teamId }),
        GetTeamOverviewCmd({ teamId: route.teamId }),
        ListPulses({ teamId: route.teamId }),
      ];
    }

    case "History": {
      return [GetMyHistoryCmd()];
    }

    case "Settings": {
      return [GetSettings(), ListFailedEmails()];
    }

    case "Pulses": {
      return [ListPulses({ teamId: route.teamId })];
    }

    case "Pulse": {
      return [GetPulse({ teamId: route.teamId, pulseId: route.pulseId })];
    }

    case "Rounds": {
      return [GetTeam({ teamId: route.teamId })];
    }

    case "RoundResults": {
      return [
        GetResultsCmd({ teamId: route.teamId, roundId: route.roundId }),
        ListActionsCmd({ teamId: route.teamId }),
        GetRoundNoteCmd({ teamId: route.teamId, roundId: route.roundId }),
        GetTeam({ teamId: route.teamId }),
      ];
    }

    case "Privacy": {
      return [ListPasskeysCmd()];
    }

    case "NotFound": {
      return [];
    }
  }
};
