import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";
import type { DocTextAttachment } from "./types";

const TAG = "extract-text";
const MAX_TEXT_LENGTH = 50_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Extracts text from a PDF buffer.
 * Uses dynamic import to avoid bundling pdf-parse in the Next.js server.
 */
export async function extractPdfText(
  data: Buffer,
  filename: string
): Promise<DocTextAttachment | null> {
  if (data.length > MAX_PDF_BYTES) {
    logger.debug(TAG, `PDF "${filename}": rejected, ${data.length} bytes exceeds ${MAX_PDF_BYTES} limit`);
    return null;
  }

  try {
    // Import from lib/pdf-parse.js directly to avoid the default entry
    // point which tries to load ./test/data/05-versions-space.pdf
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const result = await pdfParse(data);

    let text = result.text?.trim() ?? "";
    if (!text) {
      logger.debug(TAG, `PDF "${filename}": no text content extracted`);
      return null;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      logger.debug(
        TAG,
        `PDF "${filename}": truncated from ${text.length} to ${MAX_TEXT_LENGTH} chars`
      );
      text = text.slice(0, MAX_TEXT_LENGTH) + "\n[... truncated]";
    }

    logger.debug(TAG, `PDF "${filename}": extracted ${text.length} chars`);
    return { text, filename, type: "pdf" };
  } catch (error) {
    const msg = errorMessage(error);
    logger.error(TAG, `Failed to extract text from PDF "${filename}": ${msg}`);
    throw error;
  }
}

/**
 * Extracts text from a DOCX buffer.
 * Uses dynamic import to avoid bundling mammoth in the Next.js server.
 */
export async function extractDocxText(
  data: Buffer,
  filename: string
): Promise<DocTextAttachment | null> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: data });

    let text = result.value?.trim() ?? "";
    if (!text) {
      logger.debug(TAG, `DOCX "${filename}": no text content extracted`);
      return null;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      logger.debug(
        TAG,
        `DOCX "${filename}": truncated from ${text.length} to ${MAX_TEXT_LENGTH} chars`
      );
      text = text.slice(0, MAX_TEXT_LENGTH) + "\n[... truncated]";
    }

    logger.debug(TAG, `DOCX "${filename}": extracted ${text.length} chars`);
    return { text, filename, type: "docx" };
  } catch (error) {
    const msg = errorMessage(error);
    logger.error(TAG, `Failed to extract text from DOCX "${filename}": ${msg}`);
    throw error;
  }
}
