import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "react-email";
import { message } from "./messages/index.ts";

/**
 * Light colours are inline, so clients without media queries show the light version. Clients that
 * honour `prefers-color-scheme` swap to the dark palette through the classes below.
 */
export const colors = {
  page: "#f4f4f5",
  card: "#ffffff",
  text: "#18181b",
  muted: "#52525b",
  border: "#e4e4e7",
  accent: "#4338ca",
  accentText: "#ffffff",
} as const;

const darkMode = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .sb-page { background-color: #09090b !important; }
  .sb-card { background-color: #18181b !important; border-color: #27272a !important; }
  .sb-text { color: #fafafa !important; }
  .sb-muted { color: #a1a1aa !important; }
  .sb-rule { border-color: #27272a !important; }
  .sb-button { background-color: #818cf8 !important; color: #09090b !important; }
  .sb-link { color: #a5b4fc !important; }
}
`;

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The frame every SurveyBeat email shares: preview line, brand, card, and the reason it was sent. */
export function Layout({
  preview,
  reason,
  children,
}: {
  preview: string;
  reason: string;
  children: ReactNode;
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
        style={{ backgroundColor: colors.page, fontFamily: font, margin: 0, padding: "24px 0" }}
      >
        <Container style={{ maxWidth: "560px", padding: "0 16px" }}>
          <Text
            className="sb-muted"
            style={{ color: colors.muted, fontSize: "14px", fontWeight: 600, margin: "0 0 12px" }}
          >
            {message("layout.brand")}
          </Text>
          <Section
            className="sb-card"
            style={{
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: "12px",
              padding: "32px",
            }}
          >
            {children}
          </Section>
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
