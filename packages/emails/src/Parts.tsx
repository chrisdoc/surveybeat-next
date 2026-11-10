import type { ReactNode } from "react";
import { Button, Heading, Link, Section, Text } from "react-email";
import { message } from "./messages/index.ts";
import { colors, fonts, radius } from "./theme.ts";

/** The serif main heading of every email. */
export function DisplayHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      className="sb-text"
      style={{
        color: colors.text,
        fontFamily: fonts.display,
        fontSize: "30px",
        fontWeight: 400,
        letterSpacing: "-0.01em",
        lineHeight: "36px",
        margin: "0 0 16px",
      }}
    >
      {children}
    </Heading>
  );
}

export function BodyText({ children }: { children: ReactNode }) {
  return (
    <Text
      className="sb-muted"
      style={{ color: colors.muted, fontSize: "15px", lineHeight: "24px", margin: "0 0 24px" }}
    >
      {children}
    </Text>
  );
}

/** The dark call-to-action button. */
export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      className="sb-button"
      href={href}
      style={{
        backgroundColor: colors.button,
        borderRadius: radius.button,
        color: colors.buttonText,
        fontSize: "15px",
        fontWeight: 600,
        padding: "14px 24px",
        textDecoration: "none",
      }}
    >
      {children}
    </Button>
  );
}

/** The fallback link under a button. */
export function FallbackLink({ intro, href }: { intro: string; href: string }) {
  return (
    <Text
      className="sb-muted"
      style={{ color: colors.muted, fontSize: "13px", lineHeight: "20px", margin: "24px 0 0" }}
    >
      {intro}{" "}
      <Link className="sb-link" href={href} style={{ color: colors.accent, wordBreak: "break-all" }}>
        {href}
      </Link>
    </Text>
  );
}

const ratingValues = [1, 2, 3, 4, 5] as const;

/** One-tap rating: five round links in a table, end labels below. */
export function RatingRow({
  question,
  baseUrl,
  token,
}: {
  question: { readonly text: string; readonly lowLabel: string; readonly highLabel: string };
  baseUrl: string;
  token: string;
}) {
  return (
    <Section style={{ margin: "0 0 8px" }}>
      <Text
        className="sb-text"
        style={{
          color: colors.text,
          fontFamily: fonts.display,
          fontSize: "24px",
          lineHeight: "32px",
          margin: "0 0 24px",
        }}
      >
        {question.text}
      </Text>
      <table role="presentation" width="100%" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <tbody>
          <tr>
            {ratingValues.map((val) => (
              <td key={val} align="center" style={{ textAlign: "center" }}>
                <a
                  className="sb-rating"
                  href={`${baseUrl}/a#t=${token}&v=${val}`}
                  style={{
                    border: `1px solid ${colors.ratingBorder}`,
                    borderRadius: "28px",
                    boxSizing: "border-box",
                    color: colors.text,
                    display: "inline-block",
                    fontSize: "19px",
                    fontWeight: 600,
                    height: "56px",
                    lineHeight: "54px",
                    textAlign: "center",
                    textDecoration: "none",
                    width: "56px",
                  }}
                >
                  {val}
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <table role="presentation" width="100%" style={{ borderCollapse: "collapse", marginTop: "10px" }}>
        <tbody>
          <tr>
            <td
              className="sb-muted"
              align="left"
              style={{ color: colors.muted, fontSize: "13px", lineHeight: "18px" }}
            >
              {question.lowLabel}
            </td>
            <td
              className="sb-muted"
              align="right"
              style={{ color: colors.muted, fontSize: "13px", lineHeight: "18px", textAlign: "right" }}
            >
              {question.highLabel}
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

/** The call to action under a divider. */
export function ActionRow({ href }: { href: string }) {
  return (
    <Section
      className="sb-rule"
      style={{ borderTop: `1px solid ${colors.rowBorder}`, margin: "32px 0 0", paddingTop: "24px" }}
    >
      <PrimaryButton href={href}>{message("invitation.openCheckIn")}</PrimaryButton>
    </Section>
  );
}

/** Team actions in progress: a separate bordered card, rows divided by a hairline. */
export function ActionsCard({ actions }: { actions: ReadonlyArray<string> }) {
  if (actions.length === 0) return null;
  return (
    <Section
      className="sb-card"
      style={{
        backgroundColor: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        margin: "12px 0 0",
        padding: "24px 28px",
      }}
    >
      <Text
        className="sb-text"
        style={{ color: colors.text, fontSize: "15px", fontWeight: 600, margin: "0 0 6px" }}
      >
        {message("invitation.actionsHeading")}
      </Text>
      <table role="presentation" width="100%" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {actions.slice(0, 3).map((act, i) => (
            <tr key={i}>
              <td
                className="sb-text sb-rule"
                style={{
                  borderTop: `1px solid ${colors.rowBorder}`,
                  color: colors.text,
                  fontSize: "15px",
                  lineHeight: "22px",
                  padding: "10px 0",
                }}
              >
                {act}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/** The anonymity statement in the dark privacy block. */
export function PrivacyPanel({ children }: { children: ReactNode }) {
  return (
    <Section
      className="sb-panel"
      style={{
        backgroundColor: colors.panel,
        borderRadius: radius.card,
        margin: "12px 0 0",
        padding: "24px 28px",
      }}
    >
      <Text
        className="sb-panel-text"
        style={{ color: colors.panelText, fontSize: "14px", lineHeight: "22px", margin: 0 }}
      >
        {children}
      </Text>
    </Section>
  );
}

/** A small muted paragraph under the footer notices. */
export function FooterNote({ children }: { children: ReactNode }) {
  return (
    <Text
      className="sb-muted"
      style={{ color: colors.muted, fontSize: "12px", lineHeight: "19px", margin: "12px 8px 0" }}
    >
      {children}
    </Text>
  );
}

/** Small muted notices under the cards: personal link, change-delivery link, optional extras. */
export function Notices({ deliveryUrl, extra }: { deliveryUrl: string; extra?: ReactNode }) {
  return (
    <Text
      className="sb-muted"
      style={{ color: colors.muted, fontSize: "12px", lineHeight: "19px", margin: "20px 8px 0" }}
    >
      {message("invitation.personalNotice")}
      <br />
      <Link
        className="sb-link"
        href={deliveryUrl}
        style={{ color: colors.accent, textDecoration: "underline" }}
      >
        {message("invitation.changeWhen")}
      </Link>
      {extra}
    </Text>
  );
}
