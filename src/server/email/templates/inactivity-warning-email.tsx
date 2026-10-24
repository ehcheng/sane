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

export interface InactivityWarningEmailProps {
  loginUrl: string;
  daysRemaining: number;
  deactivationDate: string;
  brandName?: string;
}

function getHeading(daysRemaining: number): string {
  if (daysRemaining <= 1) return "Your account will be deactivated tomorrow";
  if (daysRemaining <= 7) return `Your account will be deactivated in ${daysRemaining} days`;
  return "Your account will be deactivated soon";
}

function getPreview(daysRemaining: number, deactivationDate: string): string {
  if (daysRemaining <= 1) return `Last chance: your account will be deactivated on ${deactivationDate}`;
  return `Your account will be deactivated on ${deactivationDate}`;
}

export function InactivityWarningEmail({
  loginUrl,
  daysRemaining,
  deactivationDate,
  brandName = "SANE",
}: InactivityWarningEmailProps) {
  const isUrgent = daysRemaining <= 1;

  return (
    <Html>
      <ResponsiveHead />
      <Preview>{getPreview(daysRemaining, deactivationDate)}</Preview>
      <Body style={body}>
        <Container style={container} className="m-container">
          {/* Header */}
          <Section style={header} className="m-section">
            <Text style={brandText}>{brandName}</Text>
          </Section>

          {/* Content */}
          <Section style={content} className="m-section">
            <Heading as="h2" style={headingStyle} className="m-heading-lg">
              {getHeading(daysRemaining)}
            </Heading>
            <Text style={messageText} className="m-body-text">
              {isUrgent
                ? `This is your final reminder. Your ${brandName} account will be deactivated on ${deactivationDate} unless you log in today.`
                : `We haven't seen you on ${brandName} in a while. Your account will be deactivated on ${deactivationDate} unless you log in.`}
            </Text>
            <Text style={messageText} className="m-body-text">
              When deactivated, email monitoring and briefs stop. Your data
              stays safe, and you can always come back by reactivating and
              reconnecting your email.
            </Text>

            {/* CTA Button */}
            <Section style={buttonContainer}>
              <Link href={loginUrl} style={isUrgent ? buttonUrgent : buttonNormal} className="m-button">
                Log In to Keep Active
              </Link>
            </Section>
          </Section>

          <Hr style={divider} className="m-divider" />

          {/* Footer */}
          <Section style={footer} className="m-section">
            <Text style={footerText} className="m-small-text">
              During summer break (mid-June to mid-August), this timer pauses
              automatically. No action needed over the summer.
            </Text>
            <Text style={footerBrand} className="m-small-text">
              {brandName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default InactivityWarningEmail;

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

const buttonNormal: React.CSSProperties = {
  backgroundColor: "#f59e0b",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "1",
  padding: "14px 24px",
  textDecoration: "none",
};

const buttonUrgent: React.CSSProperties = {
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
