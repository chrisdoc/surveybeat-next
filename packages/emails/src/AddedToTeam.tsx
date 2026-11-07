import type { AddedToTeam } from "@surveybeat/domain";
import { Button, Heading, Link, Text } from "react-email";
import { colors, Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";

const params = (email: AddedToTeam) => ({ team: email.teamName, lead: email.leadName });

export const subject = (email: AddedToTeam) => message("addedToTeam.subject", params(email));

export function AddedToTeamEmail({ email }: { email: AddedToTeam }) {
  const p = params(email);
  return (
    <Layout preview={message("addedToTeam.preview", p)} reason={message("addedToTeam.reason", p)}>
      <Heading
        as="h1"
        className="sb-text"
        style={{ color: colors.text, fontSize: "22px", lineHeight: "30px", margin: "0 0 16px" }}
      >
        {message("addedToTeam.heading", p)}
      </Heading>
      <Text
        className="sb-text"
        style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 24px" }}
      >
        {message("addedToTeam.body", p)}
      </Text>
      <Button
        className="sb-button"
        href={email.signInUrl}
        style={{
          backgroundColor: colors.accent,
          borderRadius: "8px",
          color: colors.accentText,
          fontSize: "16px",
          fontWeight: 600,
          padding: "12px 20px",
        }}
      >
        {message("addedToTeam.action")}
      </Button>
      <Text
        className="sb-muted"
        style={{ color: colors.muted, fontSize: "13px", lineHeight: "20px", margin: "24px 0 0" }}
      >
        {message("addedToTeam.link")}{" "}
        <Link
          className="sb-link"
          href={email.signInUrl}
          style={{ color: colors.accent, wordBreak: "break-all" }}
        >
          {email.signInUrl}
        </Link>
      </Text>
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
