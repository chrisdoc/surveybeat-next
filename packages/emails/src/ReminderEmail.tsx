import type { ReminderEmailWithToken as ReminderEmailData } from "@surveybeat/domain";
import { Link } from "react-email";
import { Layout, textLayout } from "./Layout.tsx";
import { answerPath, langQuery } from "./links.ts";
import { messagesFor } from "./messages/index.ts";
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
  (email.unsubscribeUrl ?? `${email.baseUrl}/api/reminders/unsubscribe?t=${email.token}`) +
  langQuery(email.locale);

export const subject = (email: ReminderEmailData): string =>
  messagesFor(email.locale).message("reminder.subject", { pulse: email.pulseName });

export function ReminderEmailComponent({ email }: { email: ReminderEmailData }) {
  const m = messagesFor(email.locale);
  const openUrl = `${email.baseUrl}${answerPath(email.locale)}#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}${langQuery(email.locale)}`;

  return (
    <Layout
      messages={m}
      preview={m.message("reminder.preview", { pulse: email.pulseName })}
      reason={m.message("invitation.reason")}
      outside={
        <>
          <ActionsCard actions={email.actions ?? []} messages={m} />
          <Notices
            messages={m}
            deliveryUrl={deliveryUrl}
            extra={
              <>
                <br />
                <Link
                  className="sb-link"
                  href={unsubscribeUrl(email)}
                  style={{ color: colors.accent, textDecoration: "underline" }}
                >
                  {m.message("reminder.unsubscribe")}
                </Link>
              </>
            }
          />
          {email.aiProcessing === true && <FooterNote>{m.message("privacy.aiNotice")}</FooterNote>}
        </>
      }
    >
      <DisplayHeading>{m.message("reminder.heading", { pulse: email.pulseName })}</DisplayHeading>
      <BodyText>{m.message("reminder.body")}</BodyText>
      {email.ratingQuestion && (
        <RatingRow
          question={email.ratingQuestion}
          baseUrl={email.baseUrl}
          token={email.token}
          locale={email.locale}
        />
      )}
      <ActionRow href={openUrl} messages={m} />
    </Layout>
  );
}

export const text = (email: ReminderEmailData): string => {
  const m = messagesFor(email.locale);
  const openUrl = `${email.baseUrl}${answerPath(email.locale)}#t=${email.token}`;
  const deliveryUrl = `${email.baseUrl}/delivery?token=${email.token}${langQuery(email.locale)}`;

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
      ratingLines.push(`${label}: ${email.baseUrl}${answerPath(email.locale)}#t=${email.token}&v=${val}`);
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
      m.message("reminder.heading", { pulse: email.pulseName }),
      "",
      m.message("reminder.body"),
      "",
      ...ratingLines,
      `${m.message("invitation.openCheckIn")}: ${openUrl}`,
      "",
      ...actionLines,
      `${m.message("invitation.changeWhen")}: ${deliveryUrl}`,
      `${m.message("reminder.unsubscribe")}: ${unsubscribeUrl(email)}`,
      ...(email.aiProcessing === true ? [m.message("privacy.aiNotice")] : []),
      m.message("invitation.personalNotice"),
    ],
    m.message("invitation.reason"),
  );
};
