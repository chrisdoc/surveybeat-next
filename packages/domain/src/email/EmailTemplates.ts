import { Context, Effect } from "effect";
import type { InvitationTokenRef } from "../rounds/Lifecycle.ts";
import type { RenderableEmail, RenderedEmail, StoredEmail } from "./Email.ts";

/** Turns what to say into a message. `packages/emails` provides it. */
export class EmailTemplates extends Context.Service<
  EmailTemplates,
  { readonly render: (email: StoredEmail) => Effect.Effect<RenderedEmail> }
>()("@surveybeat/domain/EmailTemplates") {}

/** Derives an Invitation's token (`deriveInvitationToken`) with the stage's secret key. */
export class InvitationTokens extends Context.Service<
  InvitationTokens,
  { readonly derive: (ref: InvitationTokenRef) => Effect.Effect<string> }
>()("@surveybeat/domain/InvitationTokens") {}

/** Completes a stored email for rendering: derives the token an Invitation or reminder refers to. */
export const withToken = (email: StoredEmail): Effect.Effect<RenderableEmail, never, InvitationTokens> =>
  Effect.gen(function* () {
    switch (email._tag) {
      case "InvitationEmail": {
        if ("token" in email) return email; // legacy row: it already holds its token
        const { invitation, ...rest } = email;
        const token = yield* (yield* InvitationTokens).derive(invitation);
        return { ...rest, token };
      }
      case "ReminderEmail": {
        if ("token" in email) return email;
        const { invitation, ...rest } = email;
        const token = yield* (yield* InvitationTokens).derive(invitation);
        return { ...rest, token };
      }
      default:
        return email;
    }
  });
