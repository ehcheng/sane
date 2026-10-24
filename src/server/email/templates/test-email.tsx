import {
  Html,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Preview,
  Heading,
} from "@react-email/components";
import { ResponsiveHead } from "./responsive";
import * as React from "react";

export interface TestEmailProps {
  brandName?: string;
}

export function TestEmail({ brandName = "SANE" }: TestEmailProps) {
  return (
    <Html>
      <ResponsiveHead />
      <Preview>Test email received</Preview>
      <Body style={body}>
        <Container style={container} className="m-container">
          {/* Header */}
          <Section style={header} className="m-section">
            <Text style={brandText}>{brandName}</Text>
          </Section>

          {/* Content */}
          <Section style={content} className="m-section">
            <Heading as="h2" style={headingStyle} className="m-heading-lg">
              Test email received
            </Heading>
            <Text style={messageText} className="m-body-text">
              This confirms your forwarding address is working correctly.
              Important school emails will be delivered here.
            </Text>
          </Section>

          <Hr style={divider} className="m-divider" />

          {/* Footer */}
          <Section style={footer} className="m-section">
            <Text style={footerText} className="m-small-text">
              This is a test email sent from your settings page.
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

export default TestEmail;

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
  margin: "0 0 24px 0",
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
