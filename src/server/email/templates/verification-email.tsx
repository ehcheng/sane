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

export interface VerificationEmailProps {
  type: "signup" | "forwarding" | "password-reset" | "email-change";
  verifyUrl: string;
  brandName?: string;
}

const headingMap = {
  signup: "Verify your email address",
  forwarding: "Verify your forwarding address",
  "password-reset": "Reset your password",
  "email-change": "Confirm your new email address",
};

const messageMap = {
  signup:
    "Thanks for signing up! Please verify your email address to activate monitoring.",
  forwarding:
    "Please verify this forwarding address to start receiving email summaries.",
  "password-reset":
    "We received a request to reset your password. Click the button below to choose a new password.",
  "email-change":
    "Click the button below to confirm this as your new email address.",
};

const buttonTextMap = {
  signup: "Verify Email",
  forwarding: "Verify Email",
  "password-reset": "Reset Password",
  "email-change": "Confirm Email Change",
};

export function VerificationEmail({
  type,
  verifyUrl,
  brandName = "SANE",
}: VerificationEmailProps) {
  const heading = headingMap[type];
  const message = messageMap[type];
  const buttonText = buttonTextMap[type];

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
            <Text style={s.messageText} className="m-body-text">{message}</Text>
            <Section style={s.buttonSection}>
              <Button style={s.button} href={verifyUrl} className="m-button">
                {buttonText}
              </Button>
            </Section>
            <Text style={s.metaText} className="m-meta-text">This link expires in 1 hour.</Text>
          </Section>

          <Hr style={s.divider} className="m-divider" />

          <Section style={s.footer} className="m-section">
            <Text style={s.footerText} className="m-small-text">
              If you didn&apos;t request this, you can safely ignore this email.
            </Text>
            <Text style={s.footerBrand} className="m-small-text">
              &mdash; {brandName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default VerificationEmail;
