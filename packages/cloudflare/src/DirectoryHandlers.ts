import { SurveyBeatApi } from "@surveybeat/api";
import {
  type DirectoryCommand,
  type EmailAddress,
  type EmailOutbox,
  type Member,
  NewIds,
  type NewMember,
  type OrganizationDirectory,
  runDirectoryCommand,
  viewFailedEmails,
  viewSettings,
  viewTeam,
  viewTeams,
} from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { type AuthServices, currentMember, requestOrigin, requireSameOrigin } from "./auth/AuthHandlers.ts";

/** Everything the directory endpoints need: sign-in's services, the Organization objects, the email queue. */
export type DirectoryServices = AuthServices | OrganizationDirectory | EmailOutbox;

/**
 * The "Open SurveyBeat" link in the "You've been added" email: this app's front page. Always
 * https, which the email requires; only local workerd serves plain http.
 */
const signInUrl = Effect.map(requestOrigin, (origin) => {
  const url = new URL("/", origin);
  url.protocol = "https:";
  return url.toString();
});

const newMember = (email: EmailAddress) =>
  Effect.gen(function* () {
    const ids = yield* NewIds;
    return {
      email,
      personId: yield* ids.personId,
      membershipId: yield* ids.membershipId,
      signInUrl: yield* signInUrl,
    } satisfies NewMember;
  });

/** A change: same origin only, as the signed-in Person, then 204. */
const change = <R>(command: (member: Member) => Effect.Effect<DirectoryCommand, never, R>) =>
  Effect.gen(function* () {
    yield* requireSameOrigin;
    const member = yield* currentMember;
    yield* runDirectoryCommand(member, yield* command(member));
  });

/** The `directory` group of `SurveyBeatApi`: Teams, Leads, members, and Organization settings. */
export const directoryHandlers = <R>(
  services: Effect.Effect<Context.Context<DirectoryServices>, never, R>,
) => {
  const provide = <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));
  return HttpApiBuilder.group(SurveyBeatApi, "directory", (handlers) =>
    handlers
      .handle("listTeams", () => provide(Effect.flatMap(currentMember, viewTeams)))
      .handle("createTeam", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const member = yield* currentMember;
            const teamId = yield* (yield* NewIds).teamId;
            yield* runDirectoryCommand(member, {
              _tag: "CreateTeam",
              teamId,
              name: payload.name,
              timeZone: payload.timeZone,
              lead: yield* newMember(payload.leadEmail),
            });
            return yield* viewTeam(member, teamId);
          }),
        ),
      )
      .handle("getTeam", ({ params }) =>
        provide(Effect.flatMap(currentMember, (member) => viewTeam(member, params.teamId))),
      )
      .handle("updateTeam", ({ params, payload }) =>
        provide(
          change(() =>
            Effect.succeed({
              _tag: "UpdateTeam",
              teamId: params.teamId,
              name: payload.name,
              timeZone: payload.timeZone,
            }),
          ),
        ),
      )
      .handle("addMember", ({ params, payload }) =>
        provide(
          change(() =>
            Effect.map(newMember(payload.email), (member) => ({
              _tag: "AddMember",
              teamId: params.teamId,
              role: "member",
              member,
            })),
          ),
        ),
      )
      .handle("assignLead", ({ params, payload }) =>
        provide(
          change(() =>
            Effect.map(newMember(payload.email), (member) => ({
              _tag: "AddMember",
              teamId: params.teamId,
              role: "lead",
              member,
            })),
          ),
        ),
      )
      .handle("removeMember", ({ params }) =>
        provide(
          change(() =>
            Effect.succeed({ _tag: "RemoveMember", teamId: params.teamId, personId: params.personId }),
          ),
        ),
      )
      .handle("removeLead", ({ params }) =>
        provide(
          change(() =>
            Effect.flatMap(NewIds, (ids) => ids.membershipId).pipe(
              Effect.map((membershipId) => ({
                _tag: "RemoveLead",
                teamId: params.teamId,
                personId: params.personId,
                membershipId,
              })),
            ),
          ),
        ),
      )
      .handle("getSettings", () => provide(Effect.flatMap(currentMember, viewSettings)))
      .handle("listFailedEmails", () => provide(Effect.flatMap(currentMember, viewFailedEmails)))
      .handle("updateSettings", ({ payload }) =>
        provide(
          change(() =>
            Effect.succeed({
              _tag: "UpdateSettings",
              minimumGroupSize: payload.minimumGroupSize,
              aiProcessing: payload.aiProcessing,
              defaultLocale: payload.defaultLocale,
            }),
          ),
        ),
      )
      .handle("updateOwnLanguage", ({ payload }) =>
        provide(
          change(() =>
            Effect.succeed({
              _tag: "UpdateOwnLanguage",
              locale: payload.locale,
              detectedLocale: payload.detectedLocale,
            }),
          ),
        ),
      )
      .handle("grantAdmin", ({ params }) =>
        provide(
          change(() =>
            Effect.succeed({ _tag: "SetAdmin", personId: params.personId, organizationAdmin: true }),
          ),
        ),
      )
      .handle("revokeAdmin", ({ params }) =>
        provide(
          change(() =>
            Effect.succeed({ _tag: "SetAdmin", personId: params.personId, organizationAdmin: false }),
          ),
        ),
      )
      .handle("removePerson", ({ params }) =>
        provide(change(() => Effect.succeed({ _tag: "RemovePerson", personId: params.personId }))),
      ),
  );
};
