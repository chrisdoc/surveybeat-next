import type { InvitationEmailWithToken as InvitationEmailData } from "@surveybeat/domain";
import { Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";
import { ActionRow, ActionsCard, DisplayHeading, Notices, PrivacyPanel, RatingRow } from "./Parts.tsx";

/** The AI notice, present only when the Organization processes comments with AI (ADR 0015). */
const aiNotice = (email: InvitationEmailData): string | undefined =>
  email.aiProcessing === true ? message("privacy.aiNotice") : undefined;

/**
 * What the lead will and will not see (SPEC 5.2). Rows stored before N was carried hold the finished
 * statement instead; they render verbatim.
 */
const anonymityStatement = (email: InvitationEmailData): string =>
  email.minimumGroupSize === undefined
    ? (email.anonymityStatement ?? "")
    : message("invitation.anonymity", { n: email.minimumGroupSize });

export const subject = (email: InvitationEmailData): string =>
  message("invitation.subject", { pulse: email.pulseName });

export function InvitationEmailComponent({ email }: { email: InvitationEmailData }) {
  const openUrl = `${email.baseUrl}/a#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}`;
  const notice = aiNotice(email);

  return (
    <Layout
      preview={message("invitation.preview", { pulse: email.pulseName })}
      reason={message("invitation.reason")}
      outside={
        <>
          <ActionsCard actions={email.actions} />
          <PrivacyPanel>
            {anonymityStatement(email)}
            {notice !== undefined && (
              <>
                <br />
                {notice}
              </>
            )}
          </PrivacyPanel>
          <Notices deliveryUrl={deliveryUrl} />
        </>
      }
    >
      <DisplayHeading>{email.pulseName}</DisplayHeading>
      {email.ratingQuestion && (
        <RatingRow question={email.ratingQuestion} baseUrl={email.baseUrl} token={email.token} />
      )}
      <ActionRow href={openUrl} />
    </Layout>
  );
}

export const text = (email: InvitationEmailData): string => {
  const openUrl = `${email.baseUrl}/a#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}`;
  const notice = aiNotice(email);

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
    actionLines.push(message("invitation.actionsHeading"));
    for (const act of email.actions.slice(0, 3)) {
      actionLines.push(`• ${act}`);
    }
    actionLines.push("");
  }

  return textLayout(
    [
      email.pulseName,
      "",
      anonymityStatement(email),
      ...(notice === undefined ? [] : [notice]),
      "",
      ...ratingLines,
      `${message("invitation.openCheckIn")}: ${openUrl}`,
      "",
      ...actionLines,
      `${message("invitation.changeWhen")}: ${deliveryUrl}`,
      message("invitation.personalNotice"),
    ],
    message("invitation.reason"),
  );
};
