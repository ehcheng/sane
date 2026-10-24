import { Html, Head, Body, Preview } from "@react-email/components";
import * as React from "react";

export interface ForwardedEmailProps {
  summary: string;
  subject: string;
  originalFrom: string;
  originalSubject: string;
  originalBody: string;
  originalBodyHtml?: string | null;
  childNames: string[];
  attachmentNames?: string[];
  attachmentsIncluded?: boolean;
  attachmentsOversized?: boolean;
  messageUrl?: string;
  footerText?: string | null;
  brandName?: string;
  settingsUrl?: string;
  feedbackCorrectUrl?: string | null;
  feedbackWrongUrl?: string | null;
  isManualForward?: boolean;
  alwaysForwardUrl?: string | null;
  neverForwardUrl?: string | null;
  senderEmail?: string;
  relatedEmails?: Array<{ subject: string; receivedAt: string }>;
  links?: Array<{ url: string; label: string }>;
  unsubscribeUrl?: string;
}

// ---------------------------------------------------------------------------
// Shared values
// ---------------------------------------------------------------------------
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const responsiveCss = `
  body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
  @media only screen and (max-width: 620px) {
    .wrapper-table { width: 100% !important; border-radius: 0 !important; }
    .content-td { padding-left: 16px !important; padding-right: 16px !important; }
    .footer-td { padding-left: 16px !important; padding-right: 16px !important; }
    .forwarded-content img { max-width: 100% !important; height: auto !important; }
    .summary-td { padding: 16px !important; }
    .header-table td { display: block !important; width: 100% !important; text-align: left !important; }
    .header-table td + td { padding-top: 8px !important; }
    .feedback-link { padding: 12px 24px !important; }
  }
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ForwardedEmail({
  summary,
  subject,
  originalFrom,
  originalSubject,
  originalBody,
  originalBodyHtml,
  childNames,
  attachmentNames,
  attachmentsIncluded,
  attachmentsOversized,
  messageUrl,
  footerText,
  brandName = "SANE",
  settingsUrl,
  feedbackCorrectUrl,
  feedbackWrongUrl,
  isManualForward,
  alwaysForwardUrl,
  neverForwardUrl,
  senderEmail,
  relatedEmails,
  links,
  unsubscribeUrl,
}: ForwardedEmailProps) {
  const previewText =
    summary.length > 100 ? summary.slice(0, 100) + "..." : summary;
  const childLabel = childNames.length > 0 ? childNames.join(", ") : null;

  // Parse summary into lines; detect bullet list
  const lines = summary.split("\n").filter(Boolean);
  const isBulletList = lines.every((l) => /^[•\-\*]\s/.test(l.trim()));

  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: responsiveCss }} />
      </Head>
      <Preview>{previewText}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#f4f4f4",
          color: "#333333",
          fontFamily: FONT_STACK,
        }}
      >
        {/* Full-width outer table */}
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          {...{ bgcolor: "#f4f4f4" }}
          style={{ backgroundColor: "#f4f4f4", color: "#333333" }}
        >
          <tr>
            <td align="center" style={{ padding: "20px 8px" }}>
              {/* Outlook ghost table */}
              <div
                dangerouslySetInnerHTML={{
                  __html:
                    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->',
                }}
              />

              {/* Inner 600px wrapper */}
              <table
                role="presentation"
                className="wrapper-table"
                cellPadding={0}
                cellSpacing={0}
                style={{
                  width: "100%",
                  maxWidth: "600px",
                  margin: "0 auto",
                  backgroundColor: "#ffffff",
                  color: "#333333",
                  borderRadius: "4px",
                }}
              >
                {/* ---- Header row ---- */}
                <tr>
                  <td
                    className="content-td"
                    style={{
                      padding: "16px 24px",
                      borderBottom: "1px solid #e0e0e0",
                    }}
                  >
                    <table
                      role="presentation"
                      width="100%"
                      className="header-table"
                      cellPadding={0}
                      cellSpacing={0}
                    >
                      <tr>
                        <td
                          style={{
                            fontFamily: FONT_STACK,
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#666666",
                            lineHeight: "1.5",
                          }}
                        >
                          {brandName}
                        </td>
                        {childLabel && (
                          <td
                            align="right"
                            style={{
                              fontFamily: FONT_STACK,
                              fontSize: "14px",
                              lineHeight: "1",
                            }}
                          >
                            <span
                              style={{
                                backgroundColor: "#e8f0fe",
                                borderRadius: "12px",
                                color: "#1a56db",
                                display: "inline-block",
                                fontSize: "14px",
                                fontWeight: 600,
                                lineHeight: "1",
                                padding: "6px 12px",
                              }}
                            >
                              Re: {childLabel}
                            </span>
                          </td>
                        )}
                      </tr>
                    </table>
                  </td>
                </tr>

                {/* ---- Manual forward banner ---- */}
                {isManualForward && (
                  <tr>
                    <td
                      style={{
                        padding: "10px 24px",
                        backgroundColor: "#fef3c7",
                        borderBottom: "1px solid #fde68a",
                        fontFamily: FONT_STACK,
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#92400e",
                        textTransform: "uppercase" as const,
                        letterSpacing: "0.05em",
                      }}
                    >
                      Manually forwarded
                    </td>
                  </tr>
                )}

                {/* ---- AI Summary ---- */}
                <tr>
                  <td className="content-td" style={{ padding: "20px 24px" }}>
                    <table
                      role="presentation"
                      width="100%"
                      cellPadding={0}
                      cellSpacing={0}
                      style={{
                        backgroundColor: "#f8fafc",
                        borderLeft: "3px solid #3b82f6",
                        borderRadius: "0 4px 4px 0",
                      }}
                    >
                      <tr>
                        <td
                          className="summary-td"
                          style={{
                            padding: "16px 20px",
                            fontFamily: FONT_STACK,
                          }}
                        >
                          <h2
                            style={{
                              fontSize: "20px",
                              fontWeight: 700,
                              lineHeight: "1.3",
                              color: "#1a1a2e",
                              margin: "0 0 10px 0",
                            }}
                          >
                            {subject}
                          </h2>
                          {isBulletList ? (
                            <ul
                              style={{
                                margin: "0",
                                paddingLeft: "20px",
                                color: "#374151",
                                fontSize: "16px",
                                lineHeight: "1.6",
                              }}
                            >
                              {lines.map((line, i) => (
                                <li
                                  key={i}
                                  style={{ marginBottom: "6px" }}
                                >
                                  {line.replace(/^[•\-\*]\s*/, "")}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            lines.map((line, i) => (
                              <p
                                key={i}
                                style={{
                                  fontSize: "16px",
                                  lineHeight: "1.6",
                                  color: "#374151",
                                  margin:
                                    i === lines.length - 1
                                      ? "0"
                                      : "0 0 8px 0",
                                }}
                              >
                                {line}
                              </p>
                            ))
                          )}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                {/* ---- Links ---- */}
                {links && links.length > 0 && (
                  <tr>
                    <td
                      className="content-td"
                      style={{
                        padding: "4px 24px 0",
                        fontFamily: FONT_STACK,
                        fontSize: "13px",
                        lineHeight: "1.5",
                        color: "#6b7280",
                      }}
                    >
                      <p style={{ margin: "0 0 2px 0", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "#9ca3af" }}>
                        Links
                      </p>
                      <p style={{ margin: "0 0 8px 0", fontSize: "12px", lineHeight: "1.4", color: "#6b7280" }}>
                        The following links are from the original email, not verified by {brandName}.
                      </p>
                      {links.map((link, i) => {
                        let domain: string;
                        try { domain = new URL(link.url).hostname; } catch { domain = link.url; }
                        return (
                          <p key={i} style={{ margin: "0 0 4px 0", fontSize: "14px", lineHeight: "1.6" }}>
                            <a
                              href={link.url}
                              style={{ color: "#2563eb", textDecoration: "underline" }}
                            >
                              {link.label}
                            </a>
                            <span style={{ fontSize: "12px", color: "#9ca3af" }}>{" "}({domain.replace(/\./g, "\u200B.")})</span>
                          </p>
                        );
                      })}
                    </td>
                  </tr>
                )}

                {/* ---- Related emails ---- */}
                {relatedEmails && relatedEmails.length > 0 && (
                  <tr>
                    <td
                      className="content-td"
                      style={{
                        padding: "8px 24px 0",
                        fontFamily: FONT_STACK,
                        fontSize: "13px",
                        lineHeight: "1.5",
                        color: "#9ca3af",
                      }}
                    >
                      <strong style={{ color: "#6b7280" }}>
                        Related: {relatedEmails.length} previous email{relatedEmails.length !== 1 ? "s" : ""} about this topic
                      </strong>
                      <table
                        role="presentation"
                        cellPadding={0}
                        cellSpacing={0}
                        style={{ marginTop: "4px" }}
                      >
                        {relatedEmails.map((re, i) => {
                          const d = new Date(re.receivedAt);
                          const dateStr = new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                          }).format(d);
                          return (
                            <tr key={i}>
                              <td
                                style={{
                                  fontFamily: FONT_STACK,
                                  fontSize: "13px",
                                  lineHeight: "1.6",
                                  color: "#9ca3af",
                                  paddingRight: "8px",
                                  whiteSpace: "nowrap" as const,
                                }}
                              >
                                {"\u2022"} {dateStr}
                              </td>
                              <td
                                style={{
                                  fontFamily: FONT_STACK,
                                  fontSize: "13px",
                                  lineHeight: "1.6",
                                  color: "#9ca3af",
                                }}
                              >
                                {"\u2014"} {re.subject}
                              </td>
                            </tr>
                          );
                        })}
                      </table>
                    </td>
                  </tr>
                )}

                {/* ---- Divider ---- */}
                <tr>
                  <td style={{ padding: "12px 24px 0" }}>
                    <hr
                      style={{
                        border: "none",
                        borderTop: "1px solid #e0e0e0",
                        margin: 0,
                      }}
                    />
                  </td>
                </tr>

                {/* ---- Attachments ---- */}
                {attachmentsIncluded && attachmentNames && attachmentNames.length > 0 && (
                  <tr>
                    <td
                      className="content-td"
                      style={{
                        padding: "12px 24px 0",
                        fontFamily: FONT_STACK,
                        fontSize: "14px",
                        lineHeight: "1.5",
                        color: "#666666",
                      }}
                    >
                      {"\uD83D\uDCCE"} {attachmentNames.length} attachment{attachmentNames.length !== 1 ? "s" : ""} included below
                    </td>
                  </tr>
                )}
                {attachmentsOversized && messageUrl && (
                  <tr>
                    <td
                      className="content-td"
                      style={{
                        padding: "12px 24px 0",
                        fontFamily: FONT_STACK,
                        fontSize: "14px",
                        lineHeight: "1.5",
                        color: "#666666",
                      }}
                    >
                      {"\uD83D\uDCCE"} Attachments too large &mdash;{" "}
                      <a
                        href={messageUrl}
                        style={{ color: "#0066cc", textDecoration: "underline" }}
                      >
                        view in Gmail
                      </a>
                    </td>
                  </tr>
                )}
                {!attachmentsIncluded && !attachmentsOversized && attachmentNames && attachmentNames.length > 0 && (
                  <tr>
                    <td
                      className="content-td"
                      style={{
                        padding: "12px 24px 0",
                        fontFamily: FONT_STACK,
                        fontSize: "14px",
                        lineHeight: "1.5",
                        color: "#666666",
                      }}
                    >
                      {"\uD83D\uDCCE"} Attachments:{" "}
                      {attachmentNames.join(", ")}
                    </td>
                  </tr>
                )}

                {/* ---- Original email metadata ---- */}
                <tr>
                  <td
                    className="content-td"
                    style={{
                      padding: "14px 24px 0",
                      fontFamily: FONT_STACK,
                      fontSize: "14px",
                      lineHeight: "1.5",
                      color: "#666666",
                    }}
                  >
                    <strong style={{ color: "#555555" }}>From:</strong>{" "}
                    {originalFrom}
                    <br />
                    <strong style={{ color: "#555555" }}>Subject:</strong>{" "}
                    {originalSubject}
                  </td>
                </tr>

                {/* ---- Original email body ---- */}
                <tr>
                  <td
                    className="content-td forwarded-content"
                    style={{
                      padding: "16px 24px 24px",
                      fontFamily: FONT_STACK,
                      fontSize: "16px",
                      lineHeight: "1.5",
                      color: "#1f2937",
                      overflowX: "auto" as const,
                      WebkitOverflowScrolling: "touch" as const,
                      wordBreak: "break-word" as const,
                      overflowWrap: "break-word" as const,
                      maxWidth: "100%",
                      overflow: "hidden",
                    }}
                  >
                    {originalBodyHtml ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: originalBodyHtml,
                        }}
                      />
                    ) : (
                      <p
                        style={{
                          fontSize: "16px",
                          lineHeight: "1.6",
                          color: "#374151",
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {originalBody}
                      </p>
                    )}
                  </td>
                </tr>

                {/* ---- Feedback ---- */}
                {feedbackCorrectUrl && feedbackWrongUrl && (
                  <>
                    <tr>
                      <td style={{ padding: "0 24px" }}>
                        <hr
                          style={{
                            border: "none",
                            borderTop: "1px solid #e0e0e0",
                            margin: 0,
                          }}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="content-td"
                        style={{
                          padding: "16px 24px",
                          textAlign: "center" as const,
                          fontFamily: FONT_STACK,
                        }}
                      >
                        <p
                          style={{
                            fontSize: "14px",
                            lineHeight: "1.5",
                            color: "#666666",
                            margin: "0 0 12px 0",
                          }}
                        >
                          Was this helpful?
                        </p>
                        <a
                          href={feedbackCorrectUrl}
                          className="feedback-link"
                          style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            fontSize: "16px",
                            fontWeight: 600,
                            color: "#3b82f6",
                            textDecoration: "none",
                            border: "1px solid #e0e0e0",
                            borderRadius: "6px",
                            backgroundColor: "#fafafa",
                            fontFamily: FONT_STACK,
                          }}
                        >
                          {"\uD83D\uDC4D"} Yes
                        </a>
                        <span>&nbsp;&nbsp;&nbsp;</span>
                        <a
                          href={feedbackWrongUrl}
                          className="feedback-link"
                          style={{
                            display: "inline-block",
                            padding: "10px 20px",
                            fontSize: "16px",
                            fontWeight: 600,
                            color: "#3b82f6",
                            textDecoration: "none",
                            border: "1px solid #e0e0e0",
                            borderRadius: "6px",
                            backgroundColor: "#fafafa",
                            fontFamily: FONT_STACK,
                          }}
                        >
                          {"\uD83D\uDC4E"} No
                        </a>
                      </td>
                    </tr>
                  </>
                )}

                {/* ---- Sender rule links ---- */}
                {alwaysForwardUrl && neverForwardUrl && senderEmail && (
                  <tr>
                    <td
                      className="content-td"
                      style={{
                        padding: "8px 24px 4px",
                        textAlign: "center" as const,
                        fontFamily: FONT_STACK,
                        fontSize: "13px",
                        lineHeight: "1.5",
                        color: "#9ca3af",
                      }}
                    >
                      <a
                        href={alwaysForwardUrl}
                        style={{
                          color: "#9ca3af",
                          textDecoration: "underline",
                        }}
                      >
                        Always forward from {senderEmail}
                      </a>
                      <span>&nbsp;&middot;&nbsp;</span>
                      <a
                        href={neverForwardUrl}
                        style={{
                          color: "#9ca3af",
                          textDecoration: "underline",
                        }}
                      >
                        Block this sender
                      </a>
                    </td>
                  </tr>
                )}

                {/* ---- Custom footer ---- */}
                {footerText && (
                  <>
                    <tr>
                      <td style={{ padding: "0 24px" }}>
                        <hr
                          style={{
                            border: "none",
                            borderTop: "1px solid #e0e0e0",
                            margin: 0,
                          }}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="footer-td"
                        style={{
                          padding: "16px 24px",
                          fontFamily: FONT_STACK,
                          fontSize: "14px",
                          lineHeight: "1.5",
                          color: "#666666",
                          fontStyle: "italic",
                        }}
                      >
                        {footerText}
                      </td>
                    </tr>
                  </>
                )}

                {/* ---- App footer ---- */}
                <tr>
                  <td
                    className="footer-td"
                    style={{
                      padding: "20px 24px",
                      borderTop: "1px solid #e0e0e0",
                      fontFamily: FONT_STACK,
                      fontSize: "14px",
                      lineHeight: "1.5",
                      color: "#666666",
                      textAlign: "center" as const,
                    }}
                  >
                    Forwarded by {brandName}
                    {settingsUrl && (
                      <>
                        {" "}&middot;{" "}
                        <a
                          href={settingsUrl}
                          style={{
                            color: "#0066cc",
                            textDecoration: "underline",
                          }}
                        >
                          Settings
                        </a>
                      </>
                    )}
                    {unsubscribeUrl && (
                      <>
                        {" "}&middot;{" "}
                        <a
                          href={unsubscribeUrl}
                          style={{
                            color: "#0066cc",
                            textDecoration: "underline",
                          }}
                        >
                          Unsubscribe
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              </table>

              {/* Close Outlook ghost table */}
              <div
                dangerouslySetInnerHTML={{
                  __html: "<!--[if mso]></td></tr></table><![endif]-->",
                }}
              />
            </td>
          </tr>
        </table>
      </Body>
    </Html>
  );
}

export default ForwardedEmail;
