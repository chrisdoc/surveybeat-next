import type { ResultsReadyEmail } from "@surveybeat/domain";
import { Button, Heading, Link, Text } from "react-email";
import { colors, Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";

const params = (email: ResultsReadyEmail) => ({
  pulse: email.pulseName,
  team: email.teamName,
  responseRate: email.responseRatePercent,
});

export const subject = (email: ResultsReadyEmail) => message("resultsReady.subject", params(email));

export function ResultsReadyEmailComponent({ email }: { email: ResultsReadyEmail }) {
  const p = params(email);
  return (
    <Layout preview={message("resultsReady.preview", p)} reason={message("resultsReady.reason", p)}>
      <Heading
        as="h1"
        className="sb-text"
        style={{ color: colors.text, fontSize: "22px", lineHeight: "30px", margin: "0 0 16px" }}
      >
        {message("resultsReady.heading", p)}
      </Heading>
      <Text
        className="sb-text"
        style={{ color: colors.text, fontSize: "16px", lineHeight: "24px", margin: "0 0 24px" }}
      >
        {message("resultsReady.body", p)}
      </Text>
      <Button
        className="sb-button"
        href={email.resultsUrl}
        style={{
          backgroundColor: colors.accent,
          borderRadius: "8px",
          color: colors.accentText,
          fontSize: "16px",
          fontWeight: 600,
          padding: "12px 20px",
        }}
      >
        {message("resultsReady.action")}
      </Button>
      <Text
        className="sb-muted"
        style={{ color: colors.muted, fontSize: "13px", lineHeight: "20px", margin: "24px 0 0" }}
      >
        {message("resultsReady.link")}{" "}
        <Link
          className="sb-link"
          href={email.resultsUrl}
          style={{ color: colors.accent, wordBreak: "break-all" }}
        >
          {email.resultsUrl}
        </Link>
      </Text>
    </Layout>
  );
}

export const text = (email: ResultsReadyEmail): string => {
  const p = params(email);
  return textLayout(
    [
      message("resultsReady.heading", p),
      "",
      message("resultsReady.body", p),
      "",
      `${message("resultsReady.action")}: ${email.resultsUrl}`,
    ],
    message("resultsReady.reason", p),
  );
};
