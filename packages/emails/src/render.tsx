import { EmailTemplates, type RenderedEmail, type TransactionalEmail } from "@surveybeat/domain";
import { Effect, Layer } from "effect";
import { render } from "react-email";
import * as AddedToTeam from "./AddedToTeam.tsx";
import * as InvitationEmail from "./InvitationEmail.tsx";
import * as ReminderEmail from "./ReminderEmail.tsx";
import * as ResultsReadyEmail from "./ResultsReadyEmail.tsx";

/** A subject is one header line: names with line breaks must not start another header. */
const oneLine = (subject: string) => subject.replace(/\s*[\r\n]+\s*/g, " ");

/** Renders the HTML and plain-text parts. Adding a `TransactionalEmail` variant fails to compile here. */
export const renderEmail = async (email: TransactionalEmail): Promise<RenderedEmail> => {
  switch (email._tag) {
    case "AddedToTeam":
      return {
        subject: oneLine(AddedToTeam.subject(email)),
        html: await render(<AddedToTeam.AddedToTeamEmail email={email} />),
        text: AddedToTeam.text(email),
      };
    case "InvitationEmail":
      return {
        subject: oneLine(InvitationEmail.subject(email)),
        html: await render(<InvitationEmail.InvitationEmailComponent email={email} />),
        text: InvitationEmail.text(email),
      };
    case "ReminderEmail":
      return {
        subject: oneLine(ReminderEmail.subject(email)),
        html: await render(<ReminderEmail.ReminderEmailComponent email={email} />),
        text: ReminderEmail.text(email),
        headers: {
          "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    case "ResultsReadyEmail":
      return {
        subject: oneLine(ResultsReadyEmail.subject(email)),
        html: await render(<ResultsReadyEmail.ResultsReadyEmailComponent email={email} />),
        text: ResultsReadyEmail.text(email),
      };
  }
};

/** The domain's `EmailTemplates`, rendered with React Email. A render failure is a defect. */
export const EmailTemplatesLive = Layer.succeed(EmailTemplates, {
  render: (email) => Effect.promise(() => renderEmail(email)),
});
