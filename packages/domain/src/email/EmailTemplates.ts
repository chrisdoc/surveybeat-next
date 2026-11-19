import { Context, Effect } from "effect";
import type { InvitationTokenRef, TestInvitationTokenRef } from "../rounds/Lifecycle.ts";
import type { RenderableEmail, RenderedEmail, StoredEmail } from "./Email.ts";

export class EmailTemplates extends Context.Service<
  EmailTemplates,
  { readonly render: (email: StoredEmail) => Effect.Effect<RenderedEmail> }
>()("@surveybeat/domain/EmailTemplates") {}

export class InvitationTokens extends Context.Service<
  InvitationTokens,
  {
    readonly derive: (ref: InvitationTokenRef) => Effect.Effect<string>;
    readonly deriveTest: (ref: TestInvitationTokenRef) => Effect.Effect<string>;
  }
>()("@surveybeat/domain/InvitationTokens") {}

export const withToken = (email: StoredEmail): Effect.Effect<RenderableEmail, never, InvitationTokens> =>
  Effect.gen(function* () {
    switch (email._tag) {
      case "InvitationEmail": {
        if ("token" in email) {
          return email;
        }

        const { invitation, ...rest } = email;
        const token = yield* (yield* InvitationTokens).derive(invitation);

        return { ...rest, token };
      }

      case "TestInvitationEmail": {
        const { test, ...rest } = email;
        const token = yield* (yield* InvitationTokens).deriveTest(test);

        return { ...rest, _tag: "InvitationEmail", token, test: true };
      }

      case "ReminderEmail": {
        if ("token" in email) {
          return email;
        }

        const { invitation, ...rest } = email;
        const token = yield* (yield* InvitationTokens).derive(invitation);

        return { ...rest, token };
      }

      default: {
        return email;
      }
    }
  });
