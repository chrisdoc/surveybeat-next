import { Context, type Effect } from "effect";
import type { RenderedEmail, TransactionalEmail } from "./Email.ts";

/** Turns what to say into a message. `packages/emails` provides it. */
export class EmailTemplates extends Context.Service<
  EmailTemplates,
  { readonly render: (email: TransactionalEmail) => Effect.Effect<RenderedEmail> }
>()("@surveybeat/domain/EmailTemplates") {}
