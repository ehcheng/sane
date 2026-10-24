/** Represents an image attachment ready for vision model analysis. */
export interface ImageAttachment {
  /** Base64-encoded image data */
  data: string;
  /** MIME type (e.g. image/png, image/jpeg) */
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** Original filename */
  filename: string;
  /** Size in bytes */
  sizeBytes: number;
}

/** Represents a raw PDF attachment for native provider processing (e.g. Gemini). */
export interface PdfAttachment {
  /** Base64-encoded raw PDF bytes */
  data: string;
  /** Original filename */
  filename: string;
  /** Size in bytes (raw, before base64 encoding) */
  sizeBytes: number;
}

/** Represents extracted text from a document attachment. */
export interface DocTextAttachment {
  /** Extracted plain text content */
  text: string;
  /** Original filename */
  filename: string;
  /** Document type */
  type: "pdf" | "docx";
}

/** Result of processing all attachments for a single email. */
export interface AttachmentExtractionResult {
  /** Images suitable for vision model analysis */
  images: ImageAttachment[];
  /** Extracted text from document attachments */
  docTexts: DocTextAttachment[];
  /** Raw PDF buffers for native provider processing */
  pdfAttachments: PdfAttachment[];
  /** Total number of attachments found (including unsupported types) */
  totalAttachmentCount: number;
  /** Number of image attachments found */
  imageCount: number;
  /** Errors encountered during extraction (non-fatal) */
  errors: string[];
}
