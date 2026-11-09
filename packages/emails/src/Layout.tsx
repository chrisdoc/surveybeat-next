import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "react-email";
import { message } from "./messages/index.ts";
import { colors, darkColors, fonts, radius } from "./theme.ts";

const d = darkColors;

/** Clients that honour `prefers-color-scheme` swap to the dark palette through the classes below. */
const darkMode = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .sb-page { background-color: ${d.page} !important; }
  .sb-card { background-color: ${d.card} !important; border-color: ${d.border} !important; }
  .sb-text { color: ${d.text} !important; }
  .sb-muted { color: ${d.muted} !important; }
  .sb-rule { border-color: ${d.rowBorder} !important; }
  .sb-button { background-color: ${d.button} !important; color: ${d.buttonText} !important; }
  .sb-link { color: ${d.link} !important; }
  .sb-panel { background-color: ${d.panel} !important; }
  .sb-panel-text { color: ${d.panelText} !important; }
  .sb-rating { border-color: ${d.ratingBorder} !important; color: ${d.ratingText} !important; }
}
`;

/** The frame every SurveyBeat email shares: preview line, brand, card, and the reason it was sent. */
export function Layout({
  preview,
  reason,
  children,
  outside,
}: {
  preview: string;
  reason: string;
  children: ReactNode;
  /** Extra blocks between the card and the footer, such as the privacy panel. */
  outside?: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{darkMode}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="sb-page"
        style={{ backgroundColor: colors.page, fontFamily: fonts.sans, margin: 0, padding: "40px 0" }}
      >
        <Container style={{ maxWidth: "560px", padding: "0 20px" }}>
          <Text
            className="sb-muted"
            style={{ color: colors.muted, fontSize: "15px", fontWeight: 600, margin: "0 0 16px 8px" }}
          >
            {message("layout.brand")}
          </Text>
          <Section
            className="sb-card"
            style={{
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: radius.card,
              padding: "40px 36px",
            }}
          >
            {children}
          </Section>
          {outside}
          <Hr
            className="sb-rule"
            style={{ borderTop: `1px solid ${colors.border}`, margin: "24px 0 12px" }}
          />
          <Text
            className="sb-muted"
            style={{ color: colors.muted, fontSize: "12px", lineHeight: "18px", margin: 0 }}
          >
            {reason}
          </Text>
          <Text
            className="sb-muted"
            style={{ color: colors.muted, fontSize: "12px", lineHeight: "18px", margin: "4px 0 0" }}
          >
            {message("layout.signature")}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** The plain-text part's frame, mirroring `Layout`. */
export const textLayout = (body: ReadonlyArray<string>, reason: string): string =>
  [...body, "", "--", reason, message("layout.signature"), ""].join("\n");
