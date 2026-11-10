import type { ReminderEmailWithToken as ReminderEmailData } from "@surveybeat/domain";
import { Link } from "react-email";
import { Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";
import {
  ActionRow,
  ActionsCard,
  BodyText,
  DisplayHeading,
  FooterNote,
  Notices,
  RatingRow,
} from "./Parts.tsx";
import { colors } from "./theme.ts";

/** Legacy rows carry their own URL; otherwise it is built from the token. */
export const unsubscribeUrl = (email: ReminderEmailData): string =>
  email.unsubscribeUrl ?? `${email.baseUrl}/api/reminders/unsubscribe?t=${email.token}`;

export const subject = (email: ReminderEmailData): string =>
  message("reminder.subject", { pulse: email.pulseName });

export function ReminderEmailComponent({ email }: { email: ReminderEmailData }) {
  const openUrl = `${email.baseUrl}/a#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}`;

  return (
    <Layout
      preview={message("reminder.preview", { pulse: email.pulseName })}
      reason={message("invitation.reason")}
      outside={
        <>
          <ActionsCard actions={email.actions ?? []} />
          <Notices
            deliveryUrl={deliveryUrl}
            extra={
              <>
                <br />
                <Link
                  className="sb-link"
                  href={unsubscribeUrl(email)}
                  style={{ color: colors.accent, textDecoration: "underline" }}
                >
                  {message("reminder.unsubscribe")}
                </Link>
              </>
            }
          />
          {email.aiProcessing === true && <FooterNote>{message("privacy.aiNotice")}</FooterNote>}
        </>
      }
    >
      <DisplayHeading>{message("reminder.heading", { pulse: email.pulseName })}</DisplayHeading>
      <BodyText>{message("reminder.body")}</BodyText>
      {email.ratingQuestion && (
        <RatingRow question={email.ratingQuestion} baseUrl={email.baseUrl} token={email.token} />
      )}
      <ActionRow href={openUrl} />
    </Layout>
  );
}

export const text = (email: ReminderEmailData): string => {
  const openUrl = `${email.baseUrl}/a#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}`;

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
      message("reminder.heading", { pulse: email.pulseName }),
      "",
      message("reminder.body"),
      "",
      ...ratingLines,
      `${message("invitation.openCheckIn")}: ${openUrl}`,
      "",
      ...actionLines,
      `${message("invitation.changeWhen")}: ${deliveryUrl}`,
      `${message("reminder.unsubscribe")}: ${unsubscribeUrl(email)}`,
      ...(email.aiProcessing === true ? [message("privacy.aiNotice")] : []),
      message("invitation.personalNotice"),
    ],
    message("invitation.reason"),
  );
};
