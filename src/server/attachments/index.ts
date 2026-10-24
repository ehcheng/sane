import type { gmail_v1 } from "googleapis";
import type { AttachmentPart } from "@/server/gmail/client";
import type { AttachmentExtractionResult } from "./types";
import { extractPdfText, extractDocxText } from "./extract-text";
import { processImage } from "./process-images";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const TAG = "attachments";

/** Gemini inline data limit for native PDF processing */
const MAX_NATIVE_PDF_BYTES = 20 * 1024 * 1024;

const DOC_MIME_TYPES: Record<string, "pdf" | "docx"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/tiff",
]);

/**
 * Processes all attachment parts for a single email.
 * Extracts text from PDFs/DOCX, and collects images (stub in Chunk A).
 * Each attachment is individually error-isolated.
 */
export async function extractAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
  parts: AttachmentPart[]
): Promise<AttachmentExtractionResult> {
  const result: AttachmentExtractionResult = {
    images: [],
    docTexts: [],
    pdfAttachments: [],
    totalAttachmentCount: parts.length,
    imageCount: 0,
    errors: [],
  };

  for (const part of parts) {
    try {
      const data = await getPartData(gmail, messageId, part);
      const mimeType = part.mimeType.toLowerCase();

      if (DOC_MIME_TYPES[mimeType]) {
        const docType = DOC_MIME_TYPES[mimeType];
        const extracted =
          docType === "pdf"
            ? await extractPdfText(data, part.filename)
            : await extractDocxText(data, part.filename);

        if (extracted) {
          result.docTexts.push(extracted);
        }

        // Store raw PDF buffer for native provider processing (e.g. Gemini)
        if (docType === "pdf") {
          if (data.length <= MAX_NATIVE_PDF_BYTES) {
            result.pdfAttachments.push({
              data: data.toString("base64"),
              filename: part.filename,
              sizeBytes: data.length,
            });
          } else {
            logger.debug(
              TAG,
              `PDF "${part.filename}" too large for native processing (${(data.length / 1024 / 1024).toFixed(1)}MB > 20MB), text-only fallback`
            );
          }
        }
      } else if (IMAGE_MIME_TYPES.has(mimeType)) {
        result.imageCount++;
        const image = await processImage(data, mimeType, part.filename);
        if (image) {
          result.images.push(image);
        }
      }
    } catch (error) {
      const msg = errorMessage(error);
      const errMsg = `Failed to process attachment "${part.filename}" (${part.mimeType}): ${msg}`;
      logger.error(TAG, errMsg);
      result.errors.push(errMsg);
    }
  }

  logger.debug(
    TAG,
    `Extracted ${result.docTexts.length} doc text(s), ${result.images.length} image(s), ${result.pdfAttachments.length} raw PDF(s) from ${parts.length} part(s)` +
      (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : "")
  );

  return result;
}

/**
 * Gets the raw data for an attachment part.
 * Uses inline data if available, otherwise fetches via Gmail API.
 */
async function getPartData(
  gmail: gmail_v1.Gmail,
  messageId: string,
  part: AttachmentPart
): Promise<Buffer> {
  if (part.data) {
    // Inline data is base64url-encoded
    const base64 = part.data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64");
  }

  if (part.attachmentId) {
    const { fetchAttachmentData } = await import("@/server/gmail/client");
    return fetchAttachmentData(gmail, messageId, part.attachmentId);
  }

  throw new Error(`No data or attachmentId for "${part.filename}"`);
}
