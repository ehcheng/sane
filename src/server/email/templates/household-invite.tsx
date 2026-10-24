import {
  Html,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Preview,
  Heading,
  Button,
} from "@react-email/components";
import { ResponsiveHead } from "./responsive";
import { emailStyles as s } from "./styles";
import * as React from "react";

export interface HouseholdInviteEmailProps {
  inviterName: string;
  acceptUrl: string;
  brandName?: string;
}

export function HouseholdInviteEmail({
  inviterName,
  acceptUrl,
  brandName = "SANE",
}: HouseholdInviteEmailProps) {
  return (
    <Html>
      <ResponsiveHead />
      <Preview>{inviterName} invited you to join their household on {brandName}</Preview>
      <Body style={s.body}>
        <Container style={s.container} className="m-container">
          <Section style={s.header} className="m-section">
            <Text style={s.brandText}>{brandName}</Text>
          </Section>

          <Section style={s.content} className="m-section">
            <Heading as="h2" style={s.heading} className="m-heading-lg">
              You&apos;ve been invited to a household
            </Heading>
            <Text style={{ ...s.messageText, margin: "0 0 16px 0" }} className="m-body-text">
              {inviterName} has invited you to join their household on {brandName}.
              Once you join, you&apos;ll share the same events, children, and
              school email processing. When one parent marks an event as done,
              the other will see it too.
            </Text>
            <Text style={noteText} className="m-body-text">
              If you don&apos;t have a {brandName} account yet, you&apos;ll need
              to create one first using this same email address. Then click the
              button above to join the household.
            </Text>
            <Text style={warningText} className="m-body-text">
              If you already have a {brandName} account with your own data
              (events, children, settings), that data will be replaced by the
              household&apos;s shared data when you accept.
            </Text>
            <Section style={s.buttonSection}>
              <Button style={s.button} href={acceptUrl} className="m-button">
                Accept Invite
              </Button>
            </Section>
            <Text style={s.metaText} className="m-meta-text">
              This invite expires in 7 days.
            </Text>
          </Section>

          <Hr style={s.divider} className="m-divider" />

          <Section style={s.footer} className="m-section">
            <Text style={s.footerText} className="m-small-text">
              If you weren&apos;t expecting this, you can safely ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default HouseholdInviteEmail;

// Template-specific styles (not shared)
const noteText: React.CSSProperties = {
  color: "#374151",
  backgroundColor: "#f0f9ff",
  border: "1px solid #bae6fd",
  borderRadius: "6px",
  fontSize: "14px",
  lineHeight: "1.5",
  padding: "12px 16px",
  margin: "0 0 12px 0",
};

const warningText: React.CSSProperties = {
  color: "#92400e",
  backgroundColor: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: "6px",
  fontSize: "14px",
  lineHeight: "1.5",
  padding: "12px 16px",
  margin: "0 0 24px 0",
};
