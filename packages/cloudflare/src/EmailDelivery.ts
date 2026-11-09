import type * as Cloudflare from "@alchemy.run/cloudflare";
import {
  deliver,
  deriveInvitationToken,
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

/** The domain's `SendStore` for one Organization, backed by its Durable Object. */
export const organizationSendStore = (organization: OrganizationStub) =>
  SendStore.of({
    create: (id, recipient, email) => organization.createEmailSend(id, recipient, email),
    get: (id) => organization.getEmailSend(id).pipe(Effect.map(Option.fromNullishOr)),
    claim: (id, now) => organization.claimEmailSend(id, now),
    settle: (id, attempt, outcome, now) =>
      organization.settleEmailSend(id, attempt, outcome, now).pipe(Effect.map(Option.fromNullishOr)),
    abandon: (id, now) => organization.abandonEmailSend(id, now).pipe(Effect.map(Option.fromNullishOr)),
    recordDeliveryEvent: (id, kind, code, now) =>
      organization.recordEmailDeliveryEvent(id, kind, code, now).pipe(Effect.map(Option.fromNullishOr)),
  });

/**
 * Derives Invitation tokens with the stage's `INVITATION_TOKEN_KEY` (`auth/AuthConfig.ts`). The Queue
 * consumer needs them only to render an email, so no token is ever persisted. A missing key is a
 * deploy bug, so it dies.
 */
export const InvitationTokensLive = Layer.effect(
  InvitationTokens,
  Effect.gen(function* () {
    const secret = yield* Config.Redacted("INVITATION_TOKEN_KEY");
    const key = yield* Effect.promise(() => importInvitationTokenKey(Redacted.value(secret)));
    return { derive: (ref: InvitationTokenRef) => Effect.promise(() => deriveInvitationToken(key, ref)) };
  }).pipe(Effect.orDie),
);

/**
 * Creates a send and asks the consumer to deliver it. Idempotent per `sendId`. If the enqueue
 * fails the send stays pending, and the caller (the Organization's alarm, slice 08) retries.
 */
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

/** Records which send a provider message id belongs to, for its later delivery events. */
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

/** Logs only codes and ids, never an address or any content. */
const logOutcome = (sendId: SendId, state: SendState | null) => {
  if (state === null) return Effect.logWarning("EMAIL_SEND_MISSING", { sendId });
  if (state._tag === "Failed") {
    return Effect.logWarning("EMAIL_SEND_FAILED", { sendId, reason: state.reason, code: state.code });
  }
  return Effect.void;
};

/**
 * One delivery of one queue message. Duplicates are expected: `deliver` sends at most once, and
 * the message is retried only when the send is waiting for a lease or a retry after a rejection.
 */
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
      }
    }
    yield* logOutcome(sendId, result.state);
    message.ack();
  });

/** The queue gave up on a message: fail its send rather than leave it pending (never silently). */
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

/**
 * A Cloudflare Email Sending event, as published to a Queue
 * (https://developers.cloudflare.com/email-service/reference/event-subscriptions/).
 * Only the fields SurveyBeat reads; the rest are ignored.
 */
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

/** Parses an event at the boundary. None for anything that is not an Email Sending message event. */
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

/** A bounce or complaint for a message we sent fails its send, for the Lead's view. */
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
