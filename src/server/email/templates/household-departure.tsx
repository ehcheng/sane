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
import { emailStyles as s } from "./styles";

export interface HouseholdDepartureEmailProps {
  reason: "removed" | "left" | "dissolved";
  departedName: string;
  recipientName: string;
  brandName?: string;
}

export function HouseholdDepartureEmail({
  reason,
  departedName,
  recipientName,
  brandName = "SANE",
}: HouseholdDepartureEmailProps) {
  const heading =
    reason === "dissolved"
      ? "Shared monitoring has ended"
      : reason === "removed"
        ? "You have been disconnected from shared monitoring"
        : `${departedName} has disconnected from shared monitoring`;

  const message =
    reason === "dissolved"
      ? `The household owner has ended shared monitoring on ${brandName}. You will need to log in again and set up your own account to continue using the service.`
      : reason === "removed"
        ? `You have been disconnected from shared monitoring on ${brandName}. You will need to log in again and set up your own account to continue using the service.`
        : `${departedName} is no longer connected to your shared monitoring on ${brandName}. They will no longer have access to your shared events, children, or email processing.`;

  return (
    <Html>
      <ResponsiveHead />
      <Preview>{heading}</Preview>
      <Body style={s.body}>
        <Container style={s.container} className="m-container">
          <Section style={s.header} className="m-section">
            <Text style={s.brandText}>{brandName}</Text>
          </Section>

          <Section style={s.content} className="m-section">
            <Heading as="h2" style={s.heading} className="m-heading-lg">
              {heading}
            </Heading>
            <Text style={{ ...s.messageText, margin: "0 0 16px 0" }} className="m-body-text">
              Hi {recipientName}, {message}
            </Text>
          </Section>

          <Hr style={s.divider} className="m-divider" />

          <Section style={s.footer} className="m-section">
            <Text style={s.footerText} className="m-small-text">
              This is an automated notification from {brandName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default HouseholdDepartureEmail;
