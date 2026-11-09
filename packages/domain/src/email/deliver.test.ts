import { describe, expect, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { deliver, sendTimeout } from "./deliver.ts";
import { type AddedToTeam, EmailAddress, type OutgoingEmail, SendId } from "./Email.ts";
import { type EmailAccepted, EmailOutcomeUnknown, EmailRejected, EmailSender } from "./EmailSender.ts";
import { EmailTemplates } from "./EmailTemplates.ts";
import { defaultSendPolicy, type SendPolicy } from "./SendState.ts";
import { layerMemory, SendStore } from "./SendStore.ts";

const id = SendId.make("send-1");
const recipient = EmailAddress.make("ada@example.com");
const email: AddedToTeam = {
  _tag: "AddedToTeam",
  teamName: "Platform",
  leadName: "Grace",
  signInUrl: "https://app.surveybeat.app/",
};

type Reply = Effect.Effect<EmailAccepted, EmailRejected | EmailOutcomeUnknown>;

/** A sender that answers each call with the next scripted reply and records what it was asked. */
const scriptedSender = (replies: ReadonlyArray<Reply>) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<OutgoingEmail>>([]);
    const layer = Layer.succeed(EmailSender, {
      send: (message) =>
        Ref.modify(sent, (all): [number, ReadonlyArray<OutgoingEmail>] => [
          all.length,
          [...all, message],
        ]).pipe(Effect.flatMap((index) => replies[index] ?? Effect.die(`unexpected send #${index + 1}`))),
    });
    return { sent, layer };
  });

const templates = Layer.succeed(EmailTemplates, {
  render: (content) =>
    Effect.succeed({
      subject: content._tag === "AddedToTeam" ? `Added to ${content.teamName}` : "Subject",
      html: "<p>hi</p>",
      text: "hi",
    }),
});

const accepted = (messageId: string): Reply => Effect.succeed({ messageId });

/** Runs `body` against a fresh in-memory store that already holds the pending send. */
const withSend = <A, E>(
  replies: ReadonlyArray<Reply>,
  body: (
    sent: Ref.Ref<ReadonlyArray<OutgoingEmail>>,
  ) => Effect.Effect<A, E, SendStore | EmailSender | EmailTemplates>,
  policy: SendPolicy = defaultSendPolicy,
) =>
  Effect.gen(function* () {
    const sender = yield* scriptedSender(replies);
    return yield* Effect.gen(function* () {
      yield* (yield* SendStore).create(id, recipient, email);
      return yield* body(sender.sent);
    }).pipe(Effect.provide(Layer.mergeAll(layerMemory(policy), sender.layer, templates)));
  });

const stateOf = Effect.gen(function* () {
  const record = yield* (yield* SendStore).get(id);
  return Option.map(record, (r) => r.state).pipe(Option.getOrThrow);
});

describe("deliver", () => {
  it.effect("renders and sends a pending send once", () =>
    withSend([accepted("m-1")], (sent) =>
      Effect.gen(function* () {
        const result = yield* deliver(id);
        expect(result).toEqual({ _tag: "Done", state: { _tag: "Sent", messageId: "m-1", sentAt: 0 } });
        expect(yield* Ref.get(sent)).toEqual([
          { to: recipient, subject: "Added to Platform", html: "<p>hi</p>", text: "hi" },
        ]);
      }),
    ),
  );

  it.effect("acknowledges a duplicate delivery of a sent send without sending again", () =>
    withSend([accepted("m-1")], (sent) =>
      Effect.gen(function* () {
        yield* deliver(id);
        const duplicate = yield* deliver(id);
        expect(duplicate).toEqual({ _tag: "Done", state: { _tag: "Sent", messageId: "m-1", sentAt: 0 } });
        expect(yield* Ref.get(sent)).toHaveLength(1);
      }),
    ),
  );

  it.effect("makes a concurrent duplicate wait for the lease instead of sending", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const slow: Reply = Deferred.await(release).pipe(Effect.as({ messageId: "m-1" }));
      yield* withSend([slow], (sent) =>
        Effect.gen(function* () {
          const first = yield* Effect.forkChild(deliver(id));
          yield* Effect.yieldNow;
          const duplicate = yield* deliver(id);
          expect(duplicate).toEqual({
            _tag: "RetryAfter",
            seconds: defaultSendPolicy.leaseMillis / 1000,
          });
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(first);
          expect(yield* Ref.get(sent)).toHaveLength(1);
          // Redelivered after the lease would have expired, it finds the send done.
          yield* TestClock.adjust(Duration.millis(defaultSendPolicy.leaseMillis));
          expect(yield* deliver(id)).toMatchObject({ _tag: "Done", state: { _tag: "Sent" } });
          expect(yield* Ref.get(sent)).toHaveLength(1);
        }),
      );
    }),
  );

  it.effect("fails a send whose lease expired with no outcome as unknown, and never resends it", () =>
    withSend([accepted("m-1")], (sent) =>
      Effect.gen(function* () {
        // A delivery claims the send and then dies before it learns the outcome.
        const store = yield* SendStore;
        const crashed = yield* store.claim(id, 0);
        expect(crashed._tag).toBe("Send");

        yield* TestClock.adjust(Duration.millis(defaultSendPolicy.leaseMillis));
        const unknown = {
          _tag: "Failed",
          reason: "unknown",
          code: null,
          failedAt: defaultSendPolicy.leaseMillis,
        };
        expect(yield* deliver(id)).toEqual({ _tag: "Done", state: unknown });
        expect(yield* deliver(id)).toEqual({ _tag: "Done", state: unknown });
        expect(yield* Ref.get(sent)).toHaveLength(0);

        // The crashed delivery's late answer changes nothing.
        expect(yield* store.settle(id, 1, { _tag: "Accepted", messageId: "m-late" }, 999_999)).toEqual(
          Option.some(unknown),
        );
      }),
    ),
  );

  it.effect("retries clear rejections with a growing delay, then fails", () =>
    withSend(
      [
        Effect.fail(new EmailRejected({ code: "E_RATE_LIMIT_EXCEEDED", permanent: false })),
        Effect.fail(new EmailRejected({ code: "E_RATE_LIMIT_EXCEEDED", permanent: false })),
        Effect.fail(new EmailRejected({ code: "E_DELIVERY_FAILED", permanent: false })),
      ],
      (sent) =>
        Effect.gen(function* () {
          expect(yield* deliver(id)).toEqual({ _tag: "RetryAfter", seconds: 30 });
          expect(yield* stateOf).toEqual({ _tag: "Pending", attempts: 1, lastCode: "E_RATE_LIMIT_EXCEEDED" });
          expect(yield* deliver(id)).toEqual({ _tag: "RetryAfter", seconds: 60 });
          expect(yield* deliver(id)).toEqual({
            _tag: "Done",
            state: { _tag: "Failed", reason: "rejected", code: "E_DELIVERY_FAILED", failedAt: 0 },
          });
          expect(yield* Ref.get(sent)).toHaveLength(3);
        }),
      { ...defaultSendPolicy, maxAttempts: 3 },
    ),
  );

  it.effect("fails a permanent rejection without retrying", () =>
    withSend([Effect.fail(new EmailRejected({ code: "E_RECIPIENT_SUPPRESSED", permanent: true }))], () =>
      Effect.gen(function* () {
        expect(yield* deliver(id)).toEqual({
          _tag: "Done",
          state: { _tag: "Failed", reason: "rejected", code: "E_RECIPIENT_SUPPRESSED", failedAt: 0 },
        });
      }),
    ),
  );

  it.effect("fails an ambiguous provider error as unknown without retrying", () =>
    withSend([Effect.fail(new EmailOutcomeUnknown({ code: "E_INTERNAL" }))], (sent) =>
      Effect.gen(function* () {
        expect(yield* deliver(id)).toEqual({
          _tag: "Done",
          state: { _tag: "Failed", reason: "unknown", code: "E_INTERNAL", failedAt: 0 },
        });
        expect(yield* deliver(id)).toMatchObject({ _tag: "Done", state: { reason: "unknown" } });
        expect(yield* Ref.get(sent)).toHaveLength(1);
      }),
    ),
  );

  it.effect("fails a provider call that outlives its timeout as unknown", () =>
    withSend([Effect.never], () =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(deliver(id));
        yield* TestClock.adjust(sendTimeout);
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Done",
          state: {
            _tag: "Failed",
            reason: "unknown",
            code: "E_TIMEOUT",
            failedAt: Duration.toMillis(sendTimeout),
          },
        });
      }),
    ),
  );

  it("keeps the lease longer than the provider call's timeout", () => {
    expect(defaultSendPolicy.leaseMillis).toBeGreaterThan(Duration.toMillis(sendTimeout));
  });

  it.effect("fails a send whose template cannot render, without calling the provider", () =>
    withSend([], (sent) =>
      deliver(id).pipe(
        Effect.provideService(EmailTemplates, { render: () => Effect.die("broken template") }),
        Effect.tap((result) =>
          Effect.gen(function* () {
            expect(result).toEqual({
              _tag: "Done",
              state: { _tag: "Failed", reason: "rejected", code: "E_RENDER_FAILED", failedAt: 0 },
            });
            expect(yield* Ref.get(sent)).toHaveLength(0);
          }),
        ),
      ),
    ),
  );

  it.effect("acknowledges a message for a send that does not exist", () =>
    withSend([], () =>
      Effect.gen(function* () {
        expect(yield* deliver(SendId.make("missing"))).toEqual({ _tag: "Done", state: null });
      }),
    ),
  );
});

describe("SendStore", () => {
  it.effect("creates a send once", () =>
    withSend([], () =>
      Effect.gen(function* () {
        const store = yield* SendStore;
        yield* store.claim(id, 0);
        // A second create (a retried request) neither resets nor duplicates the send.
        expect(yield* store.create(id, recipient, email)).toMatchObject({ _tag: "Sending" });
      }),
    ),
  );

  it.effect("fails a sent send on a bounce", () =>
    withSend([accepted("m-1")], () =>
      Effect.gen(function* () {
        yield* deliver(id);
        const store = yield* SendStore;
        expect(yield* store.recordDeliveryEvent(id, "bounced", "5.1.1", 7)).toEqual(
          Option.some({ _tag: "Failed", reason: "bounced", code: "5.1.1", failedAt: 7 }),
        );
      }),
    ),
  );

  it.effect("fails a dead-lettered send that never reached the provider as abandoned", () =>
    withSend([], () =>
      Effect.gen(function* () {
        expect(yield* (yield* SendStore).abandon(id, 7)).toEqual(
          Option.some({ _tag: "Failed", reason: "abandoned", code: null, failedAt: 7 }),
        );
      }),
    ),
  );
});
