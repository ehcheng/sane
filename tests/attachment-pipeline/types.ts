// ---------------------------------------------------------------------------
// Attachment Pipeline Test — Type Definitions
//
// Internal types used after fixture normalization. The fixture JSON is
// flexible (see config.ts normalizeFixture), but all downstream code
// works with these strict, canonical types.
// ---------------------------------------------------------------------------

import type { AIResponse } from "@/lib/validators";
import type {
  ImageAttachment,
  DocTextAttachment,
} from "@/server/attachments/types";

// ---- Fixture Schema (normalized) ----

export interface TestFixture {
  /** Short identifier for this fixture (used in report titles, summary) */
  name: string;
  /** Longer description of the fixture's purpose */
  description?: string;

  /** Optional user metadata (not used by pipeline, preserved for context) */
  user?: {
    email?: string;
    name?: string;
    summaryStyle?: string;
  };

  /** AI configuration overrides (env vars take precedence) */
  aiConfig?: {
    provider?: string;
    model?: string;
    visionModel?: string | null;
  };

  /** Prompt instruction overrides (merged with DEFAULTS) */
  promptInstructions?: Partial<PromptInstructions>;

  /** Children the AI should know about */
  children: ChildDef[];

  /** Activities to ignore */
  ignoredActivities: string[];

  /** Summary style for the prompt */
  summaryStyle: "CONCISE" | "STANDARD" | "DETAILED";

  /** Normalized test email definitions */
  emails: TestEmailDef[];

  /** Optional forwarding addresses (metadata, not used by pipeline) */
  forwardingAddresses?: unknown[];

  /** Optional test coverage matrix (metadata, not used by pipeline) */
  testCoverage?: unknown;
}

export interface ChildDef {
  name: string;
  grade: string;
  className?: string | null;
  teachers: string[];
  additionalInfo?: string | null;
}

export interface TestEmailDef {
  /** Test identifier — always a string after normalization (e.g. "01") */
  id: string;
  /** Short slug for directory naming — auto-generated from subject if omitted */
  slug: string;
  /** What this test case validates */
  description?: string;
  /** Email metadata */
  from: string;
  to?: string;
  subject: string;
  /** Plain-text body */
  body: string;
  /** Optional HTML body (for forwarded email rendering) */
  bodyHtml?: string | null;
  /** ISO timestamp when the email was received (resolved from date tokens) */
  receivedAt?: string | null;
  /** Relative paths to attachment files (from fixture dir) */
  attachments: string[];
  /** Expected outcome for comparison */
  expectedOutcome: ExpectedOutcome;
  /** Optional attachment type breakdown (metadata, not used by pipeline) */
  attachmentTypes?: Record<string, number>;
}

export interface ExpectedOutcome {
  send: boolean;
  /**
   * Expected child names (order-insensitive comparison).
   * - string[] → assert these exact children
   * - null/undefined → skip children assertion
   */
  children?: string[] | null;
  /** Expected total attachment count */
  attachmentCount?: number;
  /** Expected image count */
  imageCount?: number;
  /** Optional notes about why this expectation exists */
  notes?: string;
}

// ---- Prompt Config ----

export interface PromptInstructions {
  aiSystemInstruction: string;
  aiRelevanceInstruction: string;
  aiSummaryInstructionConcise: string;
  aiSummaryInstructionStandard: string;
  aiSummaryInstructionDetailed: string;
  aiResponseFormatInstruction: string;
  aiNoSendInstruction: string;
}

// ---- Runtime Config ----

export interface TestConfig {
  aiApiKey: string;
  aiProvider: "openai" | "anthropic" | "gemini";
  aiModel: string;
  aiVisionModel: string | null;
  fixtureDir: string;
  resultsDir: string;
  debug: boolean;
}

// ---- Per-Test Results ----

export interface ExtractionResult {
  images: ImageAttachment[];
  docTexts: DocTextAttachment[];
  errors: string[];
  totalAttachmentCount: number;
  imageCount: number;
}

export interface AICallResult {
  rawResponse: string;
  parsed: AIResponse;
  model: string;
  usedVision: boolean;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export interface ComparisonResult {
  passed: boolean;
  fields: {
    send: { expected: boolean; actual: boolean; match: boolean };
    children?: {
      expected: string[];
      actual: string[];
      match: boolean;
    };
    attachmentCount?: {
      expected: number;
      actual: number;
      match: boolean;
    };
    imageCount?: {
      expected: number;
      actual: number;
      match: boolean;
    };
  };
}

export interface TestResult {
  email: TestEmailDef;
  status: "pass" | "fail" | "error";
  extraction: ExtractionResult | null;
  prompt: string | null;
  aiResult: AICallResult | null;
  comparison: ComparisonResult | null;
  forwardedHtml: string | null;
  error: string | null;
  durationMs: number;
}

// ---- Run Summary ----

export interface RunSummary {
  timestamp: string;
  provider: string;
  model: string;
  visionModel: string | null;
  fixtureName: string;
  totalTests: number;
  passed: number;
  failed: number;
  errors: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalDurationMs: number;
  results: TestResult[];
}
