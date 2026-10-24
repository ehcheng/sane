/**
 * Shared responsive email styles and Head component.
 *
 * Mobile email best practices applied:
 * - Viewport meta for proper scaling
 * - Min 14px body text, 16px on mobile (Apple auto-zooms < 13px)
 * - 44px minimum tap targets for buttons/links
 * - Single-column stacking on small screens
 * - Full-width containers on mobile
 * - Adequate padding (16-20px)
 */
import { Head } from "@react-email/components";
import * as React from "react";

/**
 * Responsive CSS media queries for email templates.
 * Class names are prefixed with `m-` to avoid collisions with
 * original email HTML content.
 */
const responsiveCss = `
  /* Reset for email clients */
  body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }

  @media only screen and (max-width: 480px) {
    /* Container fills screen */
    .m-container { width: 100% !important; max-width: 100% !important; padding: 0 !important; }

    /* Stack columns vertically */
    .m-stack td, .m-stack th { display: block !important; width: 100% !important; }

    /* Bump body text to 16px minimum */
    .m-body-text { font-size: 16px !important; line-height: 1.5 !important; }

    /* Headings scale up */
    .m-heading { font-size: 20px !important; }
    .m-heading-lg { font-size: 22px !important; }

    /* Meta/secondary text stays readable */
    .m-meta-text { font-size: 14px !important; line-height: 1.5 !important; }

    /* Small/footer text */
    .m-small-text { font-size: 13px !important; }

    /* Full-width buttons with 44px min tap target */
    .m-button {
      display: block !important;
      width: 100% !important;
      padding: 14px 20px !important;
      font-size: 16px !important;
      text-align: center !important;
      box-sizing: border-box !important;
    }

    /* Feedback tap targets */
    .m-feedback-link {
      display: inline-block !important;
      padding: 12px 24px !important;
      font-size: 16px !important;
      min-height: 44px !important;
      line-height: 20px !important;
    }

    /* Pill badges */
    .m-pill { font-size: 13px !important; padding: 6px 12px !important; }

    /* Section padding increases on mobile */
    .m-section { padding-left: 16px !important; padding-right: 16px !important; }

    /* Summary box */
    .m-summary-box { margin-left: 12px !important; margin-right: 12px !important; }

    /* Stat numbers in digest */
    .m-stat-number { font-size: 28px !important; }
    .m-stat-label { font-size: 13px !important; }

    /* Dividers full-width on mobile */
    .m-divider { margin-left: 12px !important; margin-right: 12px !important; }

    /* Original email content */
    .m-original-content { overflow-x: auto !important; -webkit-overflow-scrolling: touch !important; }
  }
`;

/**
 * Drop-in replacement for <Head /> that includes viewport meta
 * and responsive CSS. Use in all email templates.
 */
export function ResponsiveHead() {
  return (
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
      <style dangerouslySetInnerHTML={{ __html: responsiveCss }} />
    </Head>
  );
}
