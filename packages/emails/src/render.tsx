// @effect-diagnostics asyncFunction:off -- React Email's render returns a Promise; the templates hold no Effect.

import { EmailTemplates, InvitationTokens, withToken } from "@surveybeat/domain";
import type { RenderableEmail, RenderedEmail } from "@surveybeat/domain";
import { Effect, Layer } from "effect";
import { render } from "react-email";
import * as AddedToTeam from "./AddedToTeam.tsx";
import * as InvitationEmail from "./InvitationEmail.tsx";
import * as ReminderEmail from "./ReminderEmail.tsx";
import * as ResultsReadyEmail from "./ResultsReadyEmail.tsx";

const oneLine = (subject: string) => subject.replaceAll(/\s*[\r\n]+\s*/g, " ");

export const renderEmail = async (email: RenderableEmail): Promise<RenderedEmail> => {
  switch (email._tag) {
    case "AddedToTeam": {
      return {
        subject: oneLine(AddedToTeam.subject(email)),
        html: await render(<AddedToTeam.AddedToTeamEmail email={email} />),
        text: AddedToTeam.text(email),
      };
    }

    case "InvitationEmail": {
      return {
        subject: oneLine(InvitationEmail.subject(email)),
        html: await render(<InvitationEmail.InvitationEmailComponent email={email} />),
        text: InvitationEmail.text(email),
      };
    }

    case "ReminderEmail": {
      return {
        subject: oneLine(ReminderEmail.subject(email)),
        html: await render(<ReminderEmail.ReminderEmailComponent email={email} />),
        text: ReminderEmail.text(email),
        headers: {
          "List-Unsubscribe": `<${ReminderEmail.unsubscribeUrl(email)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }

    case "ResultsReadyEmail": {
      return {
        subject: oneLine(ResultsReadyEmail.subject(email)),
        html: await render(<ResultsReadyEmail.ResultsReadyEmailComponent email={email} />),
        text: ResultsReadyEmail.text(email),
      };
    }
  }
};

export const EmailTemplatesLive = Layer.effect(
  EmailTemplates,
  Effect.gen(function* () {
    const tokens = yield* InvitationTokens;

    return {
      render: (email) =>
        withToken(email).pipe(
          Effect.provideService(InvitationTokens, tokens),
          Effect.flatMap((renderable) => Effect.promise(() => renderEmail(renderable))),
        ),
    };
  }),
);
