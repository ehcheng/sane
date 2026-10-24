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

export interface MonitoringStartedEmailProps {
  brandName?: string;
  settingsUrl: string;
  deliveryDescription: string[];
}

export function MonitoringStartedEmail({
  brandName = "SANE",
  settingsUrl,
  deliveryDescription,
}: MonitoringStartedEmailProps) {
  return (
    <Html>
      <ResponsiveHead />
      <Preview>Email monitoring is now active</Preview>
      <Body style={body}>
        <Container style={container} className="m-container">
          {/* Header */}
          <Section style={header} className="m-section">
            <Text style={brandTextStyle}>{brandName}</Text>
          </Section>

          {/* Content */}
          <Section style={content} className="m-section">
            <Heading as="h2" style={headingStyle} className="m-heading-lg">
              Monitoring is active
            </Heading>
            <Text style={messageText} className="m-body-text">
              {brandName} is now monitoring your connected Gmail account. Here&apos;s
              what you&apos;ll receive:
            </Text>

            {deliveryDescription.length > 0 && (
              <Section style={listContainer}>
                {deliveryDescription.map((item, i) => (
                  <Text key={i} style={listItem} className="m-body-text">
                    &bull;&nbsp;&nbsp;{item}
                  </Text>
                ))}
              </Section>
            )}

            <Text style={messageText} className="m-body-text">
              You can adjust your delivery preferences at any time from Settings.
            </Text>

            {/* CTA Button */}
            <Section style={buttonContainer}>
              <Link href={settingsUrl} style={button} className="m-button">
                Adjust Settings
              </Link>
            </Section>
          </Section>

          <Hr style={divider} className="m-divider" />

          {/* Footer */}
          <Section style={footer} className="m-section">
            <Text style={footerText} className="m-small-text">
              You&apos;re receiving this because monitoring was just enabled on
              your {brandName} account.
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

export default MonitoringStartedEmail;

// ---------------------------------------------------------------------------
// Styles
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

const brandTextStyle: React.CSSProperties = {
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

const listContainer: React.CSSProperties = {
  margin: "0 0 16px 0",
  padding: "12px 16px",
  backgroundColor: "#f8fafc",
  borderRadius: "6px",
};

const listItem: React.CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "1.5",
  margin: "0 0 6px 0",
};

const buttonContainer: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "24px 0 8px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#2563eb",
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
