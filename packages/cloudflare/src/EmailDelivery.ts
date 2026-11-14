import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  deliver,
  deriveInvitationToken,
  deriveTestInvitationToken,
  type DeliveryEventKind,
  type EmailAddress,
  type EmailSender,
  type EmailTemplates,
  importInvitationTokenKey,
  type InvitationTokenRef,
  InvitationTokens,
  OrganizationId,
  SendId,
  type SendState,
  SendStore,
  type TestInvitationTokenRef,
  testInvitationLifetimeMs,
  type TransactionalEmail,
} from "@surveybeat/domain";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { EmailSendRequested } from "./Email.ts";
import type Organization from "./Organization.ts";

export type Organizations = Effect.Success<typeof Organization>;
type OrganizationStub = ReturnType<Organizations["getByName"]>;

export const organizationSendStore = (organization: OrganizationStub) =>
  SendStore.of({
    create: (id, recipient, email) => organization.createEmailSend(id, recipient, email),
    get: (id) => organization.getEmailSend(id).pipe(Effect.map(Option.fromNullishOr)),
    claim: (id, now) => organization.claimEmailSend(id, now),
    settle: (id, attempt, outcome, now) =>
      organization.settleEmailSend(id, attempt, outcome, now).pipe(Effect.map(Option.fromNullishOr)),
    abandon: (id, now) => organization.abandonEmailSend(id, now).pipe(Effect.map(Option.fromNullishOr)),
    requeue: (id) => organization.requeueEmailSend(id),
    recordDeliveryEvent: (id, kind, code, now) =>
      organization.recordEmailDeliveryEvent(id, kind, code, now).pipe(Effect.map(Option.fromNullishOr)),
  });

export const InvitationTokensLive = Layer.effect(
  InvitationTokens,
  Effect.gen(function* () {
    const secret = yield* Config.Redacted("INVITATION_TOKEN_KEY");
    const key = yield* Effect.promise(() => importInvitationTokenKey(Redacted.value(secret)));
    return {
      derive: (ref: InvitationTokenRef) => Effect.promise(() => deriveInvitationToken(key, ref)),
      deriveTest: (ref: TestInvitationTokenRef) => Effect.promise(() => deriveTestInvitationToken(key, ref)),
    };
  }).pipe(Effect.orDie),
);

export const queueEmail = (
  organizations: Organizations,
  queue: Cloudflare.Queues.WriteQueueClient,
  request: {
    readonly organizationId: OrganizationId;
    readonly sendId: SendId;
    readonly recipient: EmailAddress;
    readonly email: TransactionalEmail;
  },
) =>
  Effect.gen(function* () {
    const state = yield* organizations
      .getByName(request.organizationId)
      .createEmailSend(request.sendId, request.recipient, request.email);
    if (state._tag === "Pending") {
      const message: EmailSendRequested = { organizationId: request.organizationId, sendId: request.sendId };
      yield* queue.send(yield* Schema.encodeEffect(EmailSendRequested)(message));
    }
    return state;
  });

const decodeRequest = Schema.decodeUnknownOption(EmailSendRequested);

const indexMessage = (db: Cloudflare.D1.QueryDatabaseClient, request: EmailSendRequested, state: SendState) =>
  state._tag === "Sent"
    ? db
        .prepare(
          "INSERT INTO email_message (message_id, organization_id, send_id) VALUES (?, ?, ?) ON CONFLICT (message_id) DO NOTHING",
        )
        .bind(state.messageId, request.organizationId, request.sendId)
        .run()
        .pipe(Effect.asVoid)
    : Effect.void;

const logOutcome = (sendId: SendId, state: SendState | null) => {
  if (state === null) return Effect.logWarning("EMAIL_SEND_MISSING", { sendId });
  if (state._tag === "Failed") {
    return Effect.logWarning("EMAIL_SEND_FAILED", { sendId, reason: state.reason, code: state.code });
  }
  return Effect.void;
};

export const handleSendMessage = (
  organizations: Organizations,
  db: Cloudflare.D1.QueryDatabaseClient,
  message: Cloudflare.Queues.Message<unknown>,
): Effect.Effect<void, never, EmailSender | EmailTemplates | RuntimeContext> =>
  Effect.gen(function* () {
    const request = decodeRequest(message.body);
    if (Option.isNone(request)) {
      yield* Effect.logError("EMAIL_MESSAGE_MALFORMED");
      return message.ack();
    }
    const { organizationId, sendId } = request.value;
    const result = yield* deliver(sendId).pipe(
      Effect.provideService(SendStore, organizationSendStore(organizations.getByName(organizationId))),
    );
    if (result._tag === "RetryAfter") return message.retry({ delaySeconds: result.seconds });
    if (result.state !== null) {
      yield* indexMessage(db, request.value, result.state);
      const inv = yield* organizations.getByName(organizationId).getInvitationBySendId(sendId);
      if (inv !== null) {
        const round = yield* organizations.getByName(organizationId).getRound(inv.roundId);
        if (round !== null) {
          yield* db
            .prepare(
              "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
            )
            .bind(inv.tokenHash, organizationId, inv.roundId, inv.personId, round.pulseId)
            .run()
            .pipe(Effect.asVoid);
        }
        if (result.state._tag === "Failed") {
          yield* organizations
            .getByName(organizationId)
            .failInvitation(inv.roundId, inv.personId, result.state.reason);
        }
      } else {
        const test = yield* organizations.getByName(organizationId).getTestSendBySendId(sendId);
        if (test !== null && result.state._tag !== "Failed") {
          yield* db
            .prepare(
              "INSERT INTO test_invitation_index (token_hash, organization_id, pulse_id, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (token_hash) DO NOTHING",
            )
            .bind(test.tokenHash, organizationId, test.pulseId, test.sentAt + testInvitationLifetimeMs)
            .run()
            .pipe(Effect.asVoid);
          for (const table of ["test_invitation_index", "test_submission_index"] as const) {
            yield* db
              .prepare(`DELETE FROM ${table} WHERE expires_at <= ?`)
              .bind(test.sentAt)
              .run()
              .pipe(Effect.asVoid);
          }
        }
      }
    }
    yield* logOutcome(sendId, result.state);
    message.ack();
  });

export const handleDeadLetter = (organizations: Organizations, message: Cloudflare.Queues.Message<unknown>) =>
  Effect.gen(function* () {
    const request = decodeRequest(message.body);
    if (Option.isSome(request)) {
      const { organizationId, sendId } = request.value;
      const state = yield* organizations
        .getByName(organizationId)
        .abandonEmailSend(sendId, yield* Clock.currentTimeMillis);
      yield* Effect.logError("EMAIL_DEAD_LETTERED", { sendId, state: state?._tag ?? null });
    } else {
      yield* Effect.logError("EMAIL_DEAD_LETTERED");
    }
    message.ack();
  });

const EmailSendingEvent = Schema.Struct({
  type: Schema.String,
  payload: Schema.Struct({
    messageId: Schema.String,
    delivery: Schema.optional(Schema.Struct({ smtpEnhancedStatusCode: Schema.optional(Schema.String) })),
    bounce: Schema.optional(Schema.Struct({ classification: Schema.optional(Schema.String) })),
    rejection: Schema.optional(Schema.Struct({ reason: Schema.optional(Schema.String) })),
    failure: Schema.optional(Schema.Struct({ reason: Schema.optional(Schema.String) })),
    complaint: Schema.optional(Schema.Struct({ type: Schema.optional(Schema.String) })),
  }),
});

const KINDS: ReadonlyArray<DeliveryEventKind> = [
  "delivered",
  "deferred",
  "bounced",
  "complained",
  "rejected",
  "failed",
];

export interface DeliveryEvent {
  readonly messageId: string;
  readonly kind: DeliveryEventKind;
  readonly code: string | null;
}

export const parseDeliveryEvent = (body: unknown): Option.Option<DeliveryEvent> =>
  Schema.decodeUnknownOption(EmailSendingEvent)(body).pipe(
    Option.flatMap((event) => {
      const name = event.type.replace(/^cf\.email\.sending\./, "").replace(/^message\./, "");
      const kind = KINDS.find((candidate) => candidate === name);
      if (kind === undefined) return Option.none();
      const { payload } = event;
      const code =
        payload.delivery?.smtpEnhancedStatusCode ??
        payload.rejection?.reason ??
        payload.failure?.reason ??
        payload.complaint?.type ??
        payload.bounce?.classification ??
        null;
      return Option.some({ messageId: payload.messageId, kind, code });
    }),
  );

const decodeRoute = Schema.decodeUnknownOption(
  Schema.Struct({ organization_id: OrganizationId, send_id: SendId }),
);

export const handleDeliveryEvent = (
  organizations: Organizations,
  db: Cloudflare.D1.QueryDatabaseClient,
  message: Cloudflare.Queues.Message<unknown>,
) =>
  Effect.gen(function* () {
    const event = parseDeliveryEvent(message.body);
    if (Option.isNone(event)) {
      yield* Effect.logWarning("EMAIL_EVENT_UNRECOGNIZED");
      return message.ack();
    }
    const row = yield* db
      .prepare("SELECT organization_id, send_id FROM email_message WHERE message_id = ?")
      .bind(event.value.messageId)
      .first();
    const route = decodeRoute(row);
    if (Option.isNone(route)) {
      yield* Effect.logWarning("EMAIL_EVENT_UNROUTED", { kind: event.value.kind });
      return message.ack();
    }
    const { organization_id, send_id } = route.value;
    const state = yield* organizations
      .getByName(organization_id)
      .recordEmailDeliveryEvent(send_id, event.value.kind, event.value.code, yield* Clock.currentTimeMillis);
    yield* logOutcome(send_id, state);
    message.ack();
  });
