import type { InvitationEmailWithToken as InvitationEmailData } from "@surveybeat/domain";
import { Layout, textLayout } from "./Layout.tsx";
import { type Messages, messagesFor } from "./messages/index.ts";
import { ActionRow, ActionsCard, DisplayHeading, Notices, PrivacyPanel, RatingRow } from "./Parts.tsx";

/** The AI notice, present only when the Organization processes comments with AI (ADR 0015). */
const aiNotice = (email: InvitationEmailData, m: Messages): string | undefined =>
  email.aiProcessing === true ? m.message("privacy.aiNotice") : undefined;

/**
 * What the lead will and will not see (SPEC 5.2). Rows stored before N was carried hold the finished
 * statement instead; they render verbatim.
 */
const anonymityStatement = (email: InvitationEmailData, m: Messages): string =>
  email.minimumGroupSize === undefined
    ? (email.anonymityStatement ?? "")
    : m.message("invitation.anonymity", { n: email.minimumGroupSize });

export const subject = (email: InvitationEmailData): string =>
  messagesFor(email.locale).message("invitation.subject", { pulse: email.pulseName });

export function InvitationEmailComponent({ email }: { email: InvitationEmailData }) {
  const m = messagesFor(email.locale);
  const openUrl = `${email.baseUrl}/a#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}`;
  const notice = aiNotice(email, m);

  return (
    <Layout
      messages={m}
      preview={m.message("invitation.preview", { pulse: email.pulseName })}
      reason={m.message("invitation.reason")}
      outside={
        <>
          <ActionsCard actions={email.actions} messages={m} />
          <PrivacyPanel>
            {anonymityStatement(email, m)}
            {notice !== undefined && (
              <>
                <br />
                {notice}
              </>
            )}
          </PrivacyPanel>
          <Notices deliveryUrl={deliveryUrl} messages={m} />
        </>
      }
    >
      <DisplayHeading>{email.pulseName}</DisplayHeading>
      {email.ratingQuestion && (
        <RatingRow question={email.ratingQuestion} baseUrl={email.baseUrl} token={email.token} />
      )}
      <ActionRow href={openUrl} messages={m} />
    </Layout>
  );
}

export const text = (email: InvitationEmailData): string => {
  const m = messagesFor(email.locale);
  const openUrl = `${email.baseUrl}/a#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}`;
  const notice = aiNotice(email, m);

  const ratingLines: Array<string> = [];
  if (email.ratingQuestion) {
    ratingLines.push(email.ratingQuestion.text, "");
    for (let val = 1; val <= 5; val++) {
      const label =
        val === 1
          ? `1 (${email.ratingQuestion.lowLabel})`
          : val === 5
            ? `5 (${email.ratingQuestion.highLabel})`
            : `${val}`;
      ratingLines.push(`${label}: ${email.baseUrl}/a#t=${email.token}&v=${val}`);
    }
    ratingLines.push("");
  }

  const actionLines: Array<string> = [];
  if (email.actions.length > 0) {
    actionLines.push(m.message("invitation.actionsHeading"));
    for (const act of email.actions.slice(0, 3)) {
      actionLines.push(`• ${act}`);
    }
    actionLines.push("");
  }

  return textLayout(
    m,
    [
      email.pulseName,
      "",
      anonymityStatement(email, m),
      ...(notice === undefined ? [] : [notice]),
      "",
      ...ratingLines,
      `${m.message("invitation.openCheckIn")}: ${openUrl}`,
      "",
      ...actionLines,
      `${m.message("invitation.changeWhen")}: ${deliveryUrl}`,
      m.message("invitation.personalNotice"),
    ],
    m.message("invitation.reason"),
  );
};
