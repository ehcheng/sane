import type { ImageAttachment } from "./types";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

const TAG = "process-images";

/** Vision-API-compatible media types */
const PASSTHROUGH_TYPES: Record<string, ImageAttachment["mediaType"]> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

/**
 * Process an image attachment for vision model analysis.
 * - PNG, JPEG, GIF, WebP pass through as base64
 * - TIFF is converted to PNG via sharp
 * - Returns null for unsupported types
 */
export async function processImage(
  data: Buffer,
  mimeType: string,
  filename: string
): Promise<ImageAttachment | null> {
  const normalizedMime = mimeType.toLowerCase();

  // Passthrough types — encode directly
  if (PASSTHROUGH_TYPES[normalizedMime]) {
    logger.debug(TAG, `Image "${filename}": passthrough ${normalizedMime} (${data.length} bytes)`);
    return {
      data: data.toString("base64"),
      mediaType: PASSTHROUGH_TYPES[normalizedMime],
      filename,
      sizeBytes: data.length,
    };
  }

  // TIFF → PNG conversion
  if (normalizedMime === "image/tiff") {
    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(data, { limitInputPixels: 50_000_000 }).png().toBuffer();

      logger.debug(
        TAG,
        `Image "${filename}": TIFF→PNG conversion (${data.length} → ${pngBuffer.length} bytes)`
      );

      return {
        data: pngBuffer.toString("base64"),
        mediaType: "image/png",
        filename,
        sizeBytes: pngBuffer.length,
      };
    } catch (error) {
      const msg = errorMessage(error);
      logger.error(TAG, `Failed to convert TIFF "${filename}": ${msg}`);
      throw error;
    }
  }

  logger.debug(TAG, `Image "${filename}": unsupported type ${normalizedMime}`);
  return null;
}
