import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Preview,
  Heading,
  Row,
  Column,
  Link,
} from "@react-email/components";
import * as React from "react";

export interface DailyBriefProps {
  brandName: string;
  childNames: string[];
  sentAt: string;             // "Mon, Feb 17"
  todayEvents: Array<{
    title: string;
    childName?: string;
    location?: string;
    time?: string;
  }>;
  upcomingEvents: Array<{
    date: string;             // day label, e.g. "Tue Feb 18"
    title: string;
    childName?: string;
    location?: string;
  }>;
  recentEmails: Array<{
    from: string;
    subject: string;
    summary?: string;
    groupCount?: number;
  }>;
  settingsUrl: string;
  dashboardUrl: string;
  footerText?: string | null;
  unsubscribeUrl?: string;
}

export function DailyBrief({
  brandName = "SANE",
  childNames,
  sentAt,
  todayEvents,
  upcomingEvents,
  recentEmails,
  settingsUrl,
  dashboardUrl,
  footerText,
  unsubscribeUrl,
}: DailyBriefProps) {
  const childLabel = childNames.length > 0 ? childNames.join(", ") : null;

  // Build preview text for inbox snippet
  const todayCount = todayEvents.length;
  const emailCount = recentEmails.length;
  const parts: string[] = [];
  if (todayCount > 0) parts.push(`${todayCount} event${todayCount === 1 ? "" : "s"} today`);
  else parts.push("Nothing on the calendar today");
  if (emailCount > 0) parts.push(`${emailCount} new email${emailCount === 1 ? "" : "s"}`);
  const previewText = parts.join(" \u00b7 ");

  // Group upcoming events by date for sectioned display
  const eventsByDate: Array<{ date: string; items: typeof upcomingEvents }> = [];
  if (upcomingEvents.length > 0) {
    const grouped = new Map<string, typeof upcomingEvents>();
    for (const ev of upcomingEvents) {
      if (!grouped.has(ev.date)) grouped.set(ev.date, []);
      grouped.get(ev.date)!.push(ev);
    }
    grouped.forEach((items, date) => {
      eventsByDate.push({ date, items });
    });
  }

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header bar */}
          <Section style={header}>
            <Row>
              <Column>
                <Text style={brandTextStyle}>{brandName}</Text>
              </Column>
              {childLabel && (
                <Column align="right">
                  <Text style={pill}>Re: {childLabel}</Text>
                </Column>
              )}
            </Row>
          </Section>

          {/* Period banner */}
          <Section style={periodBox}>
            <Heading as="h2" style={periodHeading}>
              Daily Brief &mdash; {sentAt}
            </Heading>
          </Section>

          {/* TODAY — hero section, always present */}
          <Section style={sectionBlock}>
            <Text style={sectionHeading}>TODAY</Text>
            {todayEvents.length > 0 ? (
              todayEvents.map((event, i) => (
                <div key={i} style={eventEntry}>
                  <Text style={eventText}>
                    {"\u2022 "}
                    {event.title}
                    {event.time && (
                      <span style={eventTime}> at {event.time}</span>
                    )}
                    {event.childName && (
                      <span style={eventChild}> ({event.childName})</span>
                    )}
                    {event.location && (
                      <span style={eventLocation}> @ {event.location}</span>
                    )}
                  </Text>
                </div>
              ))
            ) : (
              <Text style={emptyMessage}>Nothing on the calendar today</Text>
            )}
          </Section>

          {/* Upcoming days — rest of school week, hidden if empty */}
          {eventsByDate.length > 0 && (
            <>
              <Hr style={divider} />
              <Section style={sectionBlock}>
                {eventsByDate.map((group, gi) => (
                  <React.Fragment key={gi}>
                    {gi > 0 && <Hr style={lightSeparator} />}
                    <div style={dayGroupHeader}>
                      <Text style={dayGroupDate}>{group.date}</Text>
                    </div>
                    {group.items.map((event, ei) => (
                      <div key={ei} style={eventEntry}>
                        <Text style={eventText}>
                          {"\u2022 "}
                          {event.title}
                          {event.childName && (
                            <span style={eventChild}> ({event.childName})</span>
                          )}
                          {event.location && (
                            <span style={eventLocation}> @ {event.location}</span>
                          )}
                        </Text>
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </Section>
            </>
          )}

          {/* RECENT EMAILS */}
          <Hr style={divider} />
          <Section style={sectionBlock}>
            <Text style={sectionHeading}>
              EMAILS FROM THE LAST 24 HRS{recentEmails.length > 0 ? ` (${recentEmails.length})` : ""}
            </Text>
            {recentEmails.length > 0 ? (
              recentEmails.map((email, i) => (
                <React.Fragment key={i}>
                  <div style={emailEntry}>
                    <Text style={emailSubject}>
                      {email.subject}
                      {email.groupCount && email.groupCount > 1 && (
                        <span style={groupCountBadge}> (+{email.groupCount - 1} more)</span>
                      )}
                    </Text>
                    <Text style={emailMeta}>{email.from}</Text>
                    {email.summary && (
                      <Text style={emailSummary}>{email.summary}</Text>
                    )}
                  </div>
                  {i < recentEmails.length - 1 && (
                    <Hr style={lightSeparator} />
                  )}
                </React.Fragment>
              ))
            ) : (
              <Text style={emptyMessage}>No new school emails</Text>
            )}
          </Section>

          {/* Custom footer */}
          {footerText && (
            <>
              <Hr style={divider} />
              <Section style={customFooterSection}>
                <Text style={customFooterText}>{footerText}</Text>
              </Section>
            </>
          )}

          {/* CTA */}
          <Section style={ctaSection}>
            <Link href={dashboardUrl} style={ctaButton}>
              Open SANE
            </Link>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={appFooterText}>
              Your daily brief from {brandName} &middot;{" "}
              <Link href={settingsUrl} style={footerLink}>
                Settings
              </Link>
              {unsubscribeUrl && (
                <>
                  {" "}&middot;{" "}
                  <Link href={unsubscribeUrl} style={footerLink}>
                    Unsubscribe
                  </Link>
                </>
              )}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default DailyBrief;

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

const pill: React.CSSProperties = {
  backgroundColor: "#e8f0fe",
  borderRadius: "12px",
  color: "#1a56db",
  display: "inline-block",
  fontSize: "12px",
  fontWeight: 600,
  lineHeight: "1",
  margin: 0,
  padding: "5px 10px",
};

const periodBox: React.CSSProperties = {
  borderLeft: "3px solid #3b82f6",
  backgroundColor: "#f8fafc",
  margin: "16px 20px",
  padding: "12px 16px",
  borderRadius: "0 4px 4px 0",
};

const periodHeading: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "18px",
  fontWeight: 700,
  lineHeight: "1.3",
  margin: 0,
};

const sectionBlock: React.CSSProperties = {
  padding: "16px 20px",
};

const sectionHeading: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "15px",
  fontWeight: 700,
  lineHeight: "1.2",
  margin: "0 0 12px 0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
};

const emptyMessage: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: 0,
  fontStyle: "italic",
};

const divider: React.CSSProperties = {
  borderColor: "#e5e7eb",
  borderStyle: "solid",
  borderWidth: "1px 0 0 0",
  margin: "0 20px",
};

const lightSeparator: React.CSSProperties = {
  borderColor: "#f3f4f6",
  borderStyle: "solid",
  borderWidth: "1px 0 0 0",
  margin: "8px 0",
};

const dayGroupHeader: React.CSSProperties = {
  padding: "8px 0 2px 0",
};

const dayGroupDate: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "13px",
  fontWeight: 700,
  lineHeight: "1.2",
  margin: 0,
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
};

const eventEntry: React.CSSProperties = {
  padding: "2px 0 2px 8px",
};

const eventText: React.CSSProperties = {
  color: "#374151",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: 0,
};

const eventTime: React.CSSProperties = {
  color: "#374151",
  fontWeight: 600,
};

const eventChild: React.CSSProperties = {
  color: "#6b7280",
};

const eventLocation: React.CSSProperties = {
  color: "#6b7280",
  fontStyle: "italic",
};

const emailEntry: React.CSSProperties = {
  padding: "4px 0",
};

const emailSubject: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "1.4",
  margin: "0 0 2px 0",
};

const groupCountBadge: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: "12px",
  fontWeight: 400,
};

const emailMeta: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.4",
  margin: "0 0 2px 0",
};

const emailSummary: React.CSSProperties = {
  color: "#374151",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: 0,
};

const customFooterSection: React.CSSProperties = {
  padding: "12px 20px",
};

const customFooterText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: 0,
  fontStyle: "italic",
};

const ctaSection: React.CSSProperties = {
  padding: "8px 20px 16px 20px",
  textAlign: "center" as const,
};

const ctaButton: React.CSSProperties = {
  backgroundColor: "#3b82f6",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "1",
  padding: "12px 24px",
  textDecoration: "none",
};

const footer: React.CSSProperties = {
  padding: "12px 20px 16px 20px",
};

const appFooterText: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: "11px",
  lineHeight: "1.5",
  margin: 0,
  textAlign: "center" as const,
};

const footerLink: React.CSSProperties = {
  color: "#9ca3af",
  textDecoration: "underline",
};
