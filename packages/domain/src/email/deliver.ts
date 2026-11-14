import { Clock, Duration, Effect, Option } from "effect";
import type { SendId } from "./Email.ts";
import { EmailSender } from "./EmailSender.ts";
import { EmailTemplates } from "./EmailTemplates.ts";
import { type SendOutcome, type SendState, retryDelaySeconds } from "./SendState.ts";
import { type ClaimResult, SendStore } from "./SendStore.ts";

export const sendTimeout = Duration.seconds(30);

export type DeliveryResult =
  | { readonly _tag: "Done"; readonly state: SendState | null }
  | { readonly _tag: "RetryAfter"; readonly seconds: number };

export const deliver = Effect.fn("deliver")(function* (id: SendId) {
  const store = yield* SendStore;
  const claimed = yield* store.claim(id, yield* Clock.currentTimeMillis);
  switch (claimed._tag) {
    case "Missing":
      return done(null);
    case "Finished":
      return done(claimed.state);
    case "Wait": {
      const now = yield* Clock.currentTimeMillis;
      return retryAfter(Math.max(1, Math.ceil((claimed.until - now) / 1000)));
    }
    case "Send": {
      const outcome = yield* attempt(claimed);
      const state = yield* store.settle(id, claimed.attempt, outcome, yield* Clock.currentTimeMillis);
      if (Option.isSome(state) && state.value._tag === "Pending") {
        return retryAfter(retryDelaySeconds(claimed.attempt));
      }
      return done(Option.getOrNull(state));
    }
  }
});

const attempt = (claimed: Extract<ClaimResult, { _tag: "Send" }>) =>
  Effect.gen(function* () {
    const templates = yield* EmailTemplates;
    const sender = yield* EmailSender;

    const rendered = yield* templates.render(claimed.email).pipe(Effect.exit);
    if (rendered._tag === "Failure") return rejected("E_RENDER_FAILED", true);

    return yield* sender.send({ to: claimed.recipient, ...rendered.value }).pipe(
      Effect.timeout(sendTimeout),
      Effect.map((accepted): SendOutcome => ({ _tag: "Accepted", messageId: accepted.messageId })),
      Effect.catchTags({
        EmailRejected: (error) => Effect.succeed(rejected(error.code, error.permanent)),
        EmailOutcomeUnknown: (error) => Effect.succeed(unknown(error.code)),
        TimeoutError: () => Effect.succeed(unknown("E_TIMEOUT")),
      }),
      Effect.catchDefect(() => Effect.succeed(unknown("E_DEFECT"))),
    );
  });

const done = (state: SendState | null): DeliveryResult => ({ _tag: "Done", state });
const retryAfter = (seconds: number): DeliveryResult => ({ _tag: "RetryAfter", seconds });
const rejected = (code: string, permanent: boolean): SendOutcome => ({ _tag: "Rejected", code, permanent });
const unknown = (code: string): SendOutcome => ({ _tag: "Unknown", code });
