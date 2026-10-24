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

export interface HeartbeatStatRow {
  label: string;
  value: string;
  highlight?: "red" | "green" | "yellow";
}

export interface HeartbeatSection {
  title: string;
  rows: HeartbeatStatRow[];
}

export interface DiagnosticFindingRow {
  severity: "critical" | "warning" | "info";
  title: string;
  affectedUserCount: number;
}

export interface AdminHeartbeatProps {
  brandName?: string;
  dateRange: string;
  headingText: string;
  sections: HeartbeatSection[];
  errors?: string[];
  diagnosticCounts?: { critical: number; warning: number; info: number };
  diagnosticFindings?: DiagnosticFindingRow[];
  insightsUrl?: string;
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: "#fef2f2", text: "#dc2626", label: "CRITICAL" },
  warning: { bg: "#fffbeb", text: "#ca8a04", label: "WARNING" },
  info: { bg: "#eff6ff", text: "#2563eb", label: "INFO" },
};

export function AdminHeartbeat({
  brandName = "SANE",
  dateRange,
  headingText,
  sections,
  errors,
  diagnosticCounts,
  diagnosticFindings,
  insightsUrl,
}: AdminHeartbeatProps) {
  const hasCritical = (diagnosticCounts?.critical ?? 0) > 0;
  const totalDiagIssues = diagnosticCounts
    ? diagnosticCounts.critical + diagnosticCounts.warning + diagnosticCounts.info
    : 0;
  const diagAllClear = totalDiagIssues === 0;

  return (
    <Html>
      <ResponsiveHead />
      <Preview>{headingText} ({dateRange})</Preview>
      <Body style={body}>
        <Container style={container} className="m-container">
          {/* Header */}
          <Section style={header} className="m-section">
            <Text style={brandText}>{brandName}</Text>
          </Section>

          {/* Title */}
          <Section style={content} className="m-section">
            <Heading
              as="h2"
              style={{
                ...headingStyle,
                color: hasCritical ? "#dc2626" : "#16a34a",
              }}
              className="m-heading-lg"
            >
              {headingText}
            </Heading>
            <Text style={subheading} className="m-small-text">
              {dateRange}
            </Text>
          </Section>

          {/* Stat sections */}
          {sections.map((section, si) => (
            <React.Fragment key={si}>
              <Section style={sectionBlock} className="m-section">
                <Text style={sectionTitle}>{section.title}</Text>
                <table style={statTable} cellPadding="0" cellSpacing="0">
                  <tbody>
                    {section.rows.map((row, ri) => (
                      <tr key={ri}>
                        <td style={statLabel}>{row.label}</td>
                        <td
                          style={{
                            ...statValue,
                            ...(row.highlight === "red" ? { color: "#dc2626", fontWeight: 700 } : {}),
                            ...(row.highlight === "green" ? { color: "#16a34a" } : {}),
                            ...(row.highlight === "yellow" ? { color: "#ca8a04" } : {}),
                          }}
                        >
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
              {si < sections.length - 1 && <Hr style={divider} className="m-divider" />}
            </React.Fragment>
          ))}

          {/* Errors */}
          {errors && errors.length > 0 && (
            <>
              <Hr style={divider} className="m-divider" />
              <Section style={sectionBlock} className="m-section">
                <Text style={{ ...sectionTitle, color: "#dc2626" }}>Errors / Alerts</Text>
                {errors.map((err, i) => (
                  <Text key={i} style={errorText}>
                    {err}
                  </Text>
                ))}
              </Section>
            </>
          )}

          {/* Diagnostics section */}
          {diagnosticCounts && (
            <>
              <Hr style={divider} className="m-divider" />
              <Section style={sectionBlock} className="m-section">
                <Text style={sectionTitle}>Diagnostics</Text>
                {diagAllClear ? (
                  <Text style={allClearText}>All checks passed. No anomalies detected.</Text>
                ) : (
                  <table style={summaryTable} cellPadding="0" cellSpacing="0">
                    <tbody>
                      <tr>
                        {diagnosticCounts.critical > 0 && (
                          <td style={summaryCell}>
                            <Text style={{ ...countBadge, color: "#dc2626" }}>{diagnosticCounts.critical}</Text>
                            <Text style={countLabel}>Critical</Text>
                          </td>
                        )}
                        {diagnosticCounts.warning > 0 && (
                          <td style={summaryCell}>
                            <Text style={{ ...countBadge, color: "#ca8a04" }}>{diagnosticCounts.warning}</Text>
                            <Text style={countLabel}>Warning</Text>
                          </td>
                        )}
                        {diagnosticCounts.info > 0 && (
                          <td style={summaryCell}>
                            <Text style={{ ...countBadge, color: "#2563eb" }}>{diagnosticCounts.info}</Text>
                            <Text style={countLabel}>Info</Text>
                          </td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                )}
              </Section>

              {/* Findings table */}
              {diagnosticFindings && diagnosticFindings.length > 0 && (
                <>
                  <Hr style={divider} className="m-divider" />
                  <Section style={sectionBlock} className="m-section">
                    <Text style={sectionTitle}>Findings</Text>
                    <table style={findingsTable} cellPadding="0" cellSpacing="0">
                      <thead>
                        <tr>
                          <th style={tableHeader}>Severity</th>
                          <th style={{ ...tableHeader, textAlign: "left" as const }}>Issue</th>
                          <th style={tableHeader}>Users</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnosticFindings.map((f, i) => {
                          const sev = SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.info;
                          return (
                            <tr key={i}>
                              <td style={findingCell}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: "4px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    backgroundColor: sev.bg,
                                    color: sev.text,
                                  }}
                                >
                                  {sev.label}
                                </span>
                              </td>
                              <td style={{ ...findingCell, textAlign: "left" as const }}>
                                {f.title}
                              </td>
                              <td style={findingCell}>
                                {f.affectedUserCount > 0 ? f.affectedUserCount : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Section>
                </>
              )}
            </>
          )}

          {/* CTA */}
          {insightsUrl && (
            <>
              <Hr style={divider} className="m-divider" />
              <Section style={{ ...sectionBlock, textAlign: "center" as const }} className="m-section">
                <Link href={insightsUrl} style={ctaButton}>
                  View Insights
                </Link>
              </Section>
            </>
          )}

          <Hr style={divider} className="m-divider" />

          {/* Footer */}
          <Section style={footer} className="m-section">
            <Text style={footerText} className="m-small-text">
              This is an automated daily report from {brandName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default AdminHeartbeat;

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
  padding: "24px 20px 8px",
};

const headingStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  lineHeight: "1.3",
  margin: "0 0 4px 0",
};

const subheading: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "14px",
  margin: "0",
};

const sectionBlock: React.CSSProperties = {
  padding: "12px 20px",
};

const sectionTitle: React.CSSProperties = {
  color: "#374151",
  fontSize: "14px",
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 8px 0",
};

const statTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const statLabel: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "14px",
  padding: "3px 0",
  verticalAlign: "top",
};

const statValue: React.CSSProperties = {
  color: "#1a1a2e",
  fontSize: "14px",
  fontWeight: 600,
  padding: "3px 0",
  textAlign: "right" as const,
  verticalAlign: "top",
};

const errorText: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "13px",
  lineHeight: "1.4",
  margin: "0 0 4px 0",
  padding: "4px 8px",
  backgroundColor: "#fef2f2",
  borderRadius: "4px",
};

const allClearText: React.CSSProperties = {
  color: "#16a34a",
  fontSize: "16px",
  fontWeight: 600,
  margin: "8px 0",
};

const summaryTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const summaryCell: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "8px 16px",
};

const countBadge: React.CSSProperties = {
  fontSize: "28px",
  fontWeight: 700,
  margin: "0",
  lineHeight: "1.2",
};

const countLabel: React.CSSProperties = {
  fontSize: "12px",
  color: "#6b7280",
  margin: "0",
  textTransform: "uppercase" as const,
};

const findingsTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const tableHeader: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  padding: "6px 8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "center" as const,
};

const findingCell: React.CSSProperties = {
  fontSize: "13px",
  padding: "8px",
  borderBottom: "1px solid #f3f4f6",
  textAlign: "center" as const,
  verticalAlign: "middle" as const,
};

const ctaButton: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 24px",
  backgroundColor: "#1a1a2e",
  color: "#ffffff",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 600,
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
  margin: 0,
  textAlign: "center" as const,
};
