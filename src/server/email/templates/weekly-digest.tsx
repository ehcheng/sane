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

export interface WeeklyDigestProps {
  brandName: string;
  childNames: string[];
  periodStart: string; // pre-formatted date string
  periodEnd: string;
  stats?: {
    processed: number;
    forwarded: number;
    skipped: number;
    attachments: number;
  };
  forwardedEmails: Array<{
    from: string;
    date: string; // pre-formatted
    subject: string;
    summary: string;
    groupCount?: number;
  }>;
  settingsUrl: string;
  dashboardUrl: string;
  footerText?: string | null;
  briefTitle?: string; // "Daily Brief" | "Weekly Brief" | "Weekly Digest" (default)
  upcomingEvents?: Array<{
    date: string;      // pre-formatted, e.g. "Tue Feb 17"
    title: string;
    childName?: string;
    location?: string;
  }>;
  eventsHeading?: string;  // "Upcoming Events" or "Upcoming School Week"
  aiSummary?: string | null;
  sentAt?: string;         // pre-formatted, e.g. "Sun Feb 15, 8:00 AM"
  summaryHeading?: string; // "Week in Review" for weekly, default "SUMMARY"
  unsubscribeUrl?: string;
}

export function WeeklyDigest({
  brandName = "SANE",
  childNames,
  periodStart,
  periodEnd,
  stats,
  forwardedEmails,
  settingsUrl,
  dashboardUrl,
  footerText,
  briefTitle = "Weekly Digest",
  upcomingEvents,
  eventsHeading = "Upcoming Events",
  aiSummary,
  sentAt,
  summaryHeading: summaryHeadingProp,
  unsubscribeUrl,
}: WeeklyDigestProps) {
  const eventCount = upcomingEvents?.length ?? 0;
  const emailCount = forwardedEmails.length;
  const eventSnippet = eventCount > 0 ? `${eventCount} event${eventCount === 1 ? "" : "s"} coming up` : "";
  const emailSnippet = emailCount > 0 ? `${emailCount} email${emailCount === 1 ? "" : "s"}` : "";
  const previewParts = [eventSnippet, emailSnippet].filter(Boolean);
  const previewText = previewParts.join(", ") || `${briefTitle}`;
  const childLabel = childNames.length > 0 ? childNames.join(", ") : null;

  // Group events by date for sectioned display
  const eventsByDate: Array<{ date: string; items: typeof upcomingEvents }> = [];
  if (upcomingEvents && upcomingEvents.length > 0) {
    const grouped = new Map<string, NonNullable<typeof upcomingEvents>>();
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
                <Text style={brandText}>{brandName}</Text>
              </Column>
              {childLabel && (
                <Column align="right">
                  <Text style={pill}>Re: {childLabel}</Text>
                </Column>
              )}
            </Row>
          </Section>

          {/* Period banner — one line */}
          <Section style={periodBox}>
            <Heading as="h2" style={periodHeading}>
              {briefTitle} {"\u2014"} {briefTitle === "Weekly Brief"
                ? `${periodStart}\u2013${periodEnd}`
                : (sentAt || `${periodStart}\u2013${periodEnd}`)}
            </Heading>
          </Section>

          {/* Upcoming events — grouped by date */}
          {eventsByDate.length > 0 && (
            <>
              <Hr style={divider} />
              <Section style={emailListSection}>
                <Text style={emailListHeading}>
                  {eventsHeading} ({upcomingEvents!.length})
                </Text>
                {eventsByDate.map((group, gi) => (
                  <React.Fragment key={gi}>
                    {gi > 0 && <Hr style={emailSeparator} />}
                    <div style={dayGroupHeader}>
                      <Text style={dayGroupDate}>{group.date}</Text>
                    </div>
                    {group.items!.map((event, ei) => (
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

          {/* AI Summary */}
          {aiSummary && (
            <>
              <Hr style={divider} />
              <Section style={summarySection}>
                <Text style={summaryHeadingStyle}>{(summaryHeadingProp || "SUMMARY").toUpperCase()}</Text>
                {aiSummary.split(/\n\s*\n/).map((para, i) => (
                <Text key={i} style={i > 0 ? summaryTextPara : summaryText}>
                  {para}
                </Text>
              ))}
              </Section>
            </>
          )}

          {/* Email list */}
          {forwardedEmails.length > 0 && (
            <>
              <Hr style={divider} />
              <Section style={emailListSection}>
                <Text style={emailListHeading}>
                  {briefTitle === "Daily Brief" ? "Recent Emails" : "This Week\u2019s Emails"} ({forwardedEmails.length})
                </Text>
                {forwardedEmails.map((email, i) => (
                  <React.Fragment key={i}>
                    <div style={emailEntry}>
                      <Text style={emailSubject}>
                        {email.subject}
                        {email.groupCount && email.groupCount > 1 && (
                          <span style={groupCountBadge}> (+{email.groupCount - 1} more)</span>
                        )}
                      </Text>
                      <Text style={emailMeta}>
                        {email.from} &middot; {email.date}
                      </Text>
                      {email.summary && (
                        <Text style={emailSummary}>
                          {email.summary.length > 200
                            ? email.summary.slice(0, 200) + "..."
                            : email.summary}
                        </Text>
                      )}
                    </div>
                    {i < forwardedEmails.length - 1 && (
                      <Hr style={emailSeparator} />
                    )}
                  </React.Fragment>
                ))}
              </Section>
            </>
          )}

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
              Your {briefTitle.toLowerCase()} from {brandName} &middot;{" "}
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

export default WeeklyDigest;

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

const summarySection: React.CSSProperties = {
  padding: "16px 20px",
};

const summaryHeadingStyle: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "15px",
  fontWeight: 700,
  lineHeight: "1.2",
  margin: "0 0 12px 0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
};

const summaryText: React.CSSProperties = {
  color: "#374151",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: 0,
};

const summaryTextPara: React.CSSProperties = {
  ...summaryText,
  margin: "12px 0 0 0",
};

const divider: React.CSSProperties = {
  borderColor: "#e5e7eb",
  borderStyle: "solid",
  borderWidth: "1px 0 0 0",
  margin: "0 20px",
};

const emailListSection: React.CSSProperties = {
  padding: "16px 20px",
};

const emailListHeading: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "15px",
  fontWeight: 700,
  lineHeight: "1.2",
  margin: "0 0 12px 0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
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
  margin: "0 0 4px 0",
};

const emailSummary: React.CSSProperties = {
  color: "#374151",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: 0,
};

const emailSeparator: React.CSSProperties = {
  borderColor: "#f3f4f6",
  borderStyle: "solid",
  borderWidth: "1px 0 0 0",
  margin: "8px 0",
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

// eventDate style removed — dates now appear in dayGroupDate header

const eventChild: React.CSSProperties = {
  color: "#6b7280",
};

const eventLocation: React.CSSProperties = {
  color: "#6b7280",
  fontStyle: "italic",
};
