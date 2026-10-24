import {
  Html,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Preview,
  Heading,
  Link,
} from "@react-email/components";
import { ResponsiveHead } from "./responsive";
import * as React from "react";

export interface ReauthEmailProps {
  reconnectUrl: string;
  emailAddress: string;
  brandName?: string;
}

export function ReauthEmail({
  reconnectUrl,
  emailAddress,
  brandName = "SANE",
}: ReauthEmailProps) {
  return (
    <Html>
      <ResponsiveHead />
      <Preview>Your email connection needs attention</Preview>
      <Body style={body}>
        <Container style={container} className="m-container">
          {/* Header */}
          <Section style={header} className="m-section">
            <Text style={brandText}>{brandName}</Text>
          </Section>

          {/* Content */}
          <Section style={content} className="m-section">
            <Heading as="h2" style={headingStyle} className="m-heading-lg">
              Your email connection needs attention
            </Heading>
            <Text style={messageText} className="m-body-text">
              The connection to <strong>{emailAddress}</strong> has expired and
              email monitoring has been paused. This can happen when the
              provider revokes access or the authorization token expires.
            </Text>
            <Text style={messageText} className="m-body-text">
              To resume monitoring, please reconnect your email account.
            </Text>

            {/* CTA Button */}
            <Section style={buttonContainer}>
              <Link href={reconnectUrl} style={button} className="m-button">
                Reconnect Email
              </Link>
            </Section>
          </Section>

          <Hr style={divider} className="m-divider" />

          {/* Footer */}
          <Section style={footer} className="m-section">
            <Text style={footerText} className="m-small-text">
              If you didn&apos;t expect this email, you can safely ignore it.
              Your account is secure.
            </Text>
            <Text style={footerBrand} className="m-small-text">
              &mdash; {brandName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ReauthEmail;

// ---------------------------------------------------------------------------
// Styles — mobile-optimized base sizes
// ---------------------------------------------------------------------------

const body: React.CSSProperties = {
  backgroundColor: "#ffffff",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  margin: "0 auto",
  maxWidth: "640px",
  padding: "0",
};

const header: React.CSSProperties = {
  padding: "16px 20px",
  borderBottom: "1px solid #e5e7eb",
};

const brandText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
};

const content: React.CSSProperties = {
  padding: "24px 20px",
};

const headingStyle: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "20px",
  fontWeight: 700,
  lineHeight: "1.3",
  margin: "0 0 12px 0",
};

const messageText: React.CSSProperties = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.6",
  margin: "0 0 16px 0",
};

const buttonContainer: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "24px 0 8px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#dc2626",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "1",
  padding: "14px 24px",
  textDecoration: "none",
};

const divider: React.CSSProperties = {
  borderColor: "#e5e7eb",
  borderStyle: "solid",
  borderWidth: "1px 0 0 0",
  margin: "0 20px",
};

const footer: React.CSSProperties = {
  padding: "16px 20px",
};

const footerText: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 4px 0",
  textAlign: "center" as const,
};

const footerBrand: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: 0,
  textAlign: "center" as const,
};
