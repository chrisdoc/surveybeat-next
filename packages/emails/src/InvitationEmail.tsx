import type { InvitationEmailWithToken as InvitationEmailData } from "@surveybeat/domain";
import { Button, Heading, Link, Section, Text } from "react-email";
import { colors, Layout, textLayout } from "./Layout.tsx";
import { message } from "./messages/index.ts";

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

  return (
    <Layout
      preview={message("invitation.preview", { pulse: email.pulseName })}
      reason={message("invitation.reason")}
    >
      <Heading
        as="h1"
        className="sb-text"
        style={{ color: colors.text, fontSize: "22px", lineHeight: "30px", margin: "0 0 12px" }}
      >
        {email.pulseName}
      </Heading>

      <Text
        className="sb-muted"
        style={{ color: colors.muted, fontSize: "14px", lineHeight: "20px", margin: "0 0 20px" }}
      >
        {anonymityStatement(email)}
      </Text>

      {email.ratingQuestion && (
        <Section style={{ margin: "20px 0" }}>
          <Text
            className="sb-text"
            style={{ color: colors.text, fontSize: "16px", fontWeight: 600, margin: "0 0 12px" }}
          >
            {email.ratingQuestion.text}
          </Text>
          <div style={{ display: "flex", gap: "8px", margin: "12px 0", flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((val) => {
              const label =
                val === 1
                  ? `1 · ${email.ratingQuestion?.lowLabel}`
                  : val === 5
                    ? `5 · ${email.ratingQuestion?.highLabel}`
                    : `${val}`;
              return (
                <Button
                  key={val}
                  className="sb-button"
                  href={`${email.baseUrl}/a#t=${email.token}&v=${val}`}
                  style={{
                    backgroundColor: colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: "6px",
                    color: colors.text,
                    fontSize: "14px",
                    fontWeight: 500,
                    padding: "8px 14px",
                    textDecoration: "none",
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </Section>
      )}

      <div style={{ margin: "24px 0" }}>
        <Button
          className="sb-button"
          href={openUrl}
          style={{
            backgroundColor: colors.accent,
            borderRadius: "8px",
            color: colors.accentText,
            fontSize: "16px",
            fontWeight: 600,
            padding: "12px 20px",
            textDecoration: "none",
          }}
        >
          {message("invitation.openCheckIn")}
        </Button>
      </div>

      {email.actions.length > 0 && (
        <Section style={{ margin: "24px 0 16px" }}>
          <Text
            className="sb-text"
            style={{ color: colors.text, fontSize: "14px", fontWeight: 600, margin: "0 0 8px" }}
          >
            {message("invitation.actionsHeading")}
          </Text>
          <ul style={{ margin: 0, paddingLeft: "20px", color: colors.muted, fontSize: "14px" }}>
            {email.actions.slice(0, 3).map((act, i) => (
              <li key={i}>{act}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0 0", paddingTop: "16px" }}>
        <Text className="sb-muted" style={{ color: colors.muted, fontSize: "12px", margin: "0 0 4px" }}>
          <Link href={deliveryUrl} style={{ color: colors.accent, textDecoration: "underline" }}>
            {message("invitation.changeWhen")}
          </Link>
        </Text>
        <Text className="sb-muted" style={{ color: colors.muted, fontSize: "12px", margin: 0 }}>
          {message("invitation.personalNotice")}
        </Text>
      </Section>
    </Layout>
  );
}

export const text = (email: InvitationEmailData): string => {
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
      email.pulseName,
      "",
      anonymityStatement(email),
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
