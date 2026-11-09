import type { AddedToTeam } from "@surveybeat/domain";
import { Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";
import { BodyText, DisplayHeading, FallbackLink, PrimaryButton } from "./Parts.tsx";

const params = (email: AddedToTeam) => ({ team: email.teamName, lead: email.leadName });

export const subject = (email: AddedToTeam) => message("addedToTeam.subject", params(email));

export function AddedToTeamEmail({ email }: { email: AddedToTeam }) {
  const p = params(email);
  return (
    <Layout preview={message("addedToTeam.preview", p)} reason={message("addedToTeam.reason", p)}>
      <DisplayHeading>{message("addedToTeam.heading", p)}</DisplayHeading>
      <BodyText>{message("addedToTeam.body", p)}</BodyText>
      <PrimaryButton href={email.signInUrl}>{message("addedToTeam.action")}</PrimaryButton>
      <FallbackLink intro={message("addedToTeam.link")} href={email.signInUrl} />
    </Layout>
  );
}

export const text = (email: AddedToTeam): string => {
  const p = params(email);
  return textLayout(
    [
      message("addedToTeam.heading", p),
      "",
      message("addedToTeam.body", p),
      "",
      `${message("addedToTeam.action")}: ${email.signInUrl}`,
    ],
    message("addedToTeam.reason", p),
  );
};
