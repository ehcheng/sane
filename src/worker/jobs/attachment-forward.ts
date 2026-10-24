/**
 * Shared logic for fetching attachment data for email forwarding.
 * Used by both process-user-emails and manual-forward jobs.
 */

import type { gmail_v1 } from "googleapis";
import type { AttachmentPart } from "@/server/gmail/client";
import logger from "@/lib/logger";

const TAG = "attachment-forward";

// ---------------------------------------------------------------------------
// Allowlist: MIME types safe to forward as email attachments.
// Anything NOT on this list is silently skipped (allowlist > blocklist).
// ---------------------------------------------------------------------------
const FORWARDABLE_MIME_TYPES = new Set([
  // Documents
  "application/pdf",
  "application/rtf",
  "text/rtf",
  "text/plain",
  "text/csv",
  "text/calendar",                                                              // .ics

  // Microsoft Office (non-macro)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",    // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",          // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",  // .pptx

  // OpenDocument
  "application/vnd.oasis.opendocument.text",                                   // .odt
  "application/vnd.oasis.opendocument.spreadsheet",                            // .ods
  "application/vnd.oasis.opendocument.presentation",                           // .odp

  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
  "image/svg+xml",
]);

// ---------------------------------------------------------------------------
// Blocklist: known dangerous MIME types / extensions.
// Used only for logging — the allowlist already prevents forwarding.
// Matches by MIME type OR file extension as a defense-in-depth measure.
// ---------------------------------------------------------------------------
const DANGEROUS_MIME_TYPES = new Set([
  "application/x-msdownload",         // .exe, .dll
  "application/x-executable",
  "application/x-msdos-program",
  "application/x-msi",                // .msi
  "application/x-bat",                // .bat
  "application/x-sh",                 // .sh
  "application/x-csh",
  "application/x-powershell",         // .ps1
  "application/x-javascript",         // .js (as attachment)
  "application/javascript",
  "text/javascript",
  "application/java-archive",         // .jar
  "application/x-java-class",         // .class
  "application/hta",                   // .hta
  "application/x-ms-shortcut",        // .lnk
  "application/vnd.ms-word.document.macroEnabled.12",         // .docm
  "application/vnd.ms-excel.sheet.macroEnabled.12",           // .xlsm
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12", // .pptm
]);

const DANGEROUS_EXTENSIONS = new Set([
  // Executables & installers
  ".exe", ".dll", ".com", ".scr", ".pif", ".msi", ".msp", ".mst", ".cpl",
  // Scripts
  ".bat", ".cmd", ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".psd1",
  ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".ws",
  // Web scripts / HTML applications
  ".hta", ".htm", ".html", ".svg",  // SVG in allowlist by MIME but not as raw .svg file download
  // Java
  ".jar", ".class", ".jnlp",
  // Office macro-enabled formats
  ".docm", ".xlsm", ".pptm", ".dotm", ".xltm", ".potm", ".sldm",
  // Shortcuts & registry
  ".lnk", ".url", ".reg", ".inf",
  // System
  ".sys", ".drv", ".ocx",
  // Misc
  ".iso", ".img", ".vhd", ".vhdx",  // disk images (can auto-mount)
  ".cab", ".appx", ".msix",
  ".py", ".rb", ".pl", ".php", ".cgi",
]);

function isDangerous(mimeType: string, filename: string): boolean {
  if (DANGEROUS_MIME_TYPES.has(mimeType)) return true;
  const ext = filename.lastIndexOf(".") >= 0
    ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
    : "";
  return DANGEROUS_EXTENSIONS.has(ext);
}

/** 10MB total cap for all attachments */
const MAX_TOTAL_SIZE = 10 * 1024 * 1024;

interface ForwardableAttachmentResult {
  attachments: Array<{ filename: string; content: Buffer }>;
  oversized: boolean;
}

/**
 * Fetches attachment data for forwarding.
 * Only includes disposition=attachment parts with forwardable MIME types.
 * If total size exceeds 10MB, returns empty attachments + oversized=true.
 */
export async function fetchForwardableAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentParts: AttachmentPart[],
  userId?: string,
): Promise<ForwardableAttachmentResult> {
  // Log any dangerous attachments for visibility
  const dangerous = attachmentParts.filter(
    (p) => p.disposition === "attachment" && isDangerous(p.mimeType, p.filename)
  );
  if (dangerous.length > 0) {
    logger.warn(
      TAG,
      `message=${messageId}: blocked ${dangerous.length} dangerous attachment(s): ${dangerous.map((p) => `${p.filename} (${p.mimeType})`).join(", ")}`
    );
  }

  const forwardable = attachmentParts.filter(
    (p) => p.disposition === "attachment" && FORWARDABLE_MIME_TYPES.has(p.mimeType)
  );

  // Also skip attachments that pass MIME check but have dangerous extensions (defense-in-depth)
  const safeForwardable = forwardable.filter((p) => {
    if (isDangerous(p.mimeType, p.filename)) {
      logger.warn(TAG, `message=${messageId}: MIME-allowed but extension-blocked: ${p.filename}`);
      return false;
    }
    return true;
  });

  if (safeForwardable.length === 0) {
    return { attachments: [], oversized: false };
  }

  // Quick check: estimate total size from sizeEstimate
  const estimatedTotal = safeForwardable.reduce((sum, p) => sum + p.sizeEstimate, 0);
  if (estimatedTotal > MAX_TOTAL_SIZE) {
    logger.info(
      TAG,
      `message=${messageId}: attachments too large (est ${Math.round(estimatedTotal / 1024)}KB), falling back to Gmail link`
    );
    return { attachments: [], oversized: true };
  }

  // Fetch actual data
  const { fetchAttachmentData } = await import("@/server/gmail/client");
  const results: Array<{ filename: string; content: Buffer }> = [];
  let totalSize = 0;

  for (const part of safeForwardable) {
    try {
      let buffer: Buffer;
      if (part.data) {
        // Small part: inline base64url data
        const base64 = part.data.replace(/-/g, "+").replace(/_/g, "/");
        buffer = Buffer.from(base64, "base64");
      } else if (part.attachmentId) {
        // Large part: fetch via API
        buffer = await fetchAttachmentData(gmail, messageId, part.attachmentId, userId);
      } else {
        continue;
      }

      totalSize += buffer.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        logger.info(
          TAG,
          `message=${messageId}: attachments exceeded ${MAX_TOTAL_SIZE} bytes after fetching, falling back to Gmail link`
        );
        return { attachments: [], oversized: true };
      }

      results.push({ filename: part.filename, content: buffer });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(TAG, `message=${messageId}: failed to fetch attachment ${part.filename}: ${msg}`);
      // Skip this attachment but continue with others
    }
  }

  logger.debug(
    TAG,
    `message=${messageId}: ${results.length} attachment(s) fetched (${Math.round(totalSize / 1024)}KB total)`
  );

  return { attachments: results, oversized: false };
}
