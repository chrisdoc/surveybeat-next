import type {
  DeliveryEventKind,
  EmailAddress,
  makeSendStore,
  SendId,
  SendOutcome,
  StoredEmail,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

type Sends = ReturnType<typeof makeSendStore>;

export const organizationSends = (sends: Sends) => ({
  createEmailSend: (id: SendId, recipient: EmailAddress, email: StoredEmail) =>
    sends.create(id, recipient, email),
  getEmailSend: (id: SendId) => sends.get(id).pipe(Effect.map(Option.getOrNull)),
  claimEmailSend: (id: SendId, now: number) => sends.claim(id, now),
  settleEmailSend: (id: SendId, attempt: number, outcome: SendOutcome, now: number) =>
    sends.settle(id, attempt, outcome, now).pipe(Effect.map(Option.getOrNull)),
  abandonEmailSend: (id: SendId, now: number) => sends.abandon(id, now).pipe(Effect.map(Option.getOrNull)),
  requeueEmailSend: (id: SendId) => sends.requeue(id),
  recordEmailDeliveryEvent: (id: SendId, kind: DeliveryEventKind, code: string | null, now: number) =>
    sends.recordDeliveryEvent(id, kind, code, now).pipe(Effect.map(Option.getOrNull)),
});
