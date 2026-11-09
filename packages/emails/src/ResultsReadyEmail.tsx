import type { ResultsReadyEmail } from "@surveybeat/domain";
import { Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";
import { BodyText, DisplayHeading, FallbackLink, PrimaryButton } from "./Parts.tsx";

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
      <DisplayHeading>{message("resultsReady.heading", p)}</DisplayHeading>
      <BodyText>{message("resultsReady.body", p)}</BodyText>
      <PrimaryButton href={email.resultsUrl}>{message("resultsReady.action")}</PrimaryButton>
      <FallbackLink intro={message("resultsReady.link")} href={email.resultsUrl} />
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
