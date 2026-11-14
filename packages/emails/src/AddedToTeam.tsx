import type { AddedToTeam } from "@surveybeat/domain";
import { Layout, textLayout } from "./Layout.tsx";
import { messagesFor } from "./messages/index.ts";
import { BodyText, DisplayHeading, FallbackLink, PrimaryButton } from "./Parts.tsx";

const params = (email: AddedToTeam) => ({ team: email.teamName, lead: email.leadName });

export const subject = (email: AddedToTeam) =>
  messagesFor(email.locale).message("addedToTeam.subject", params(email));

export function AddedToTeamEmail({ email }: { email: AddedToTeam }) {
  const m = messagesFor(email.locale);
  const p = params(email);
  return (
    <Layout
      messages={m}
      preview={m.message("addedToTeam.preview", p)}
      reason={m.message("addedToTeam.reason", p)}
    >
      <DisplayHeading>{m.message("addedToTeam.heading", p)}</DisplayHeading>
      <BodyText>{m.message("addedToTeam.body", p)}</BodyText>
      <PrimaryButton href={email.signInUrl}>{m.message("addedToTeam.action")}</PrimaryButton>
      <FallbackLink intro={m.message("addedToTeam.link")} href={email.signInUrl} />
    </Layout>
  );
}

export const text = (email: AddedToTeam): string => {
  const m = messagesFor(email.locale);
  const p = params(email);
  return textLayout(
    m,
    [
      m.message("addedToTeam.heading", p),
      "",
      m.message("addedToTeam.body", p),
      "",
      `${m.message("addedToTeam.action")}: ${email.signInUrl}`,
    ],
    m.message("addedToTeam.reason", p),
  );
};
