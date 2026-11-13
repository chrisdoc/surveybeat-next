import type { ResultsReadyEmail } from "@surveybeat/domain";
import { Layout, textLayout } from "./Layout.tsx";
import { messagesFor } from "./messages/index.ts";
import { BodyText, DisplayHeading, FallbackLink, PrimaryButton } from "./Parts.tsx";

const params = (email: ResultsReadyEmail) => ({
  pulse: email.pulseName,
  team: email.teamName,
  responseRate: email.responseRatePercent,
});

export const subject = (email: ResultsReadyEmail) =>
  messagesFor(email.locale).message("resultsReady.subject", params(email));

export function ResultsReadyEmailComponent({ email }: { email: ResultsReadyEmail }) {
  const m = messagesFor(email.locale);
  const p = params(email);
  return (
    <Layout
      messages={m}
      preview={m.message("resultsReady.preview", p)}
      reason={m.message("resultsReady.reason", p)}
    >
      <DisplayHeading>{m.message("resultsReady.heading", p)}</DisplayHeading>
      <BodyText>{m.message("resultsReady.body", p)}</BodyText>
      <PrimaryButton href={email.resultsUrl}>{m.message("resultsReady.action")}</PrimaryButton>
      <FallbackLink intro={m.message("resultsReady.link")} href={email.resultsUrl} />
    </Layout>
  );
}

export const text = (email: ResultsReadyEmail): string => {
  const m = messagesFor(email.locale);
  const p = params(email);
  return textLayout(
    m,
    [
      m.message("resultsReady.heading", p),
      "",
      m.message("resultsReady.body", p),
      "",
      `${m.message("resultsReady.action")}: ${email.resultsUrl}`,
    ],
    m.message("resultsReady.reason", p),
  );
};
