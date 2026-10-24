#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// SANE — Attachment Pipeline Test Runner
//
// Usage: npm run test:pipeline [path/to/fixture.json]
//
// Runs each test email through the real extraction → prompt → AI → parse
// pipeline and produces a detailed HTML report.
// ---------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";
import { parseCLIArgs, loadFixture, loadTestConfig, getPromptConfig } from "./config";
import {
  printTestProgress,
  printSummary,
  writeArtifacts,
  writeSummaryJson,
  writeHtmlReport,
} from "./report";
import type {
  TestConfig,
  TestEmailDef,
  ChildDef,
  PromptInstructions,
  ExtractionResult,
  AICallResult,
  ComparisonResult,
  TestResult,
  RunSummary,
} from "./types";
import type { AIResponse, SummaryStyle } from "@/lib/validators";
import type { ImageAttachment, DocTextAttachment } from "@/server/attachments/types";

// ---------------------------------------------------------------------------
// GRADE_DESCRIPTIONS — duplicated from prompt-builder.ts (avoids Prisma dep)
// ---------------------------------------------------------------------------

const GRADE_DESCRIPTIONS: Record<string, string> = {
  "pre-k": "Pre-Kindergarten (ages 3-4)",
  preschool: "Pre-School (ages 3-4)",
  tk: "Transitional Kindergarten (ages 4-5)",
  kindergarten: "Kindergarten (ages 5-6)",
  "1st": "1st grade (elementary school, ages 6-7)",
  "2nd": "2nd grade (elementary school, ages 7-8)",
  "3rd": "3rd grade (elementary school, ages 8-9)",
  "4th": "4th grade (elementary school, ages 9-10)",
  "5th": "5th grade (elementary school, ages 10-11)",
  "6th": "6th grade (middle school, ages 11-12)",
  "7th": "7th grade (middle school, ages 12-13)",
  "8th": "8th grade (middle school, ages 13-14)",
  "9th": "9th grade (high school freshman, ages 14-15)",
  "10th": "10th grade (high school sophomore, ages 15-16)",
  "11th": "11th grade (high school junior, ages 16-17)",
  "12th": "12th grade (high school senior, ages 17-18)",
  "college-freshman": "College Freshman",
  "college-sophomore": "College Sophomore",
  "college-junior": "College Junior",
  "college-senior": "College Senior",
};

function gradeToDescription(grade: string): string {
  return GRADE_DESCRIPTIONS[grade] ?? grade;
}

// ---------------------------------------------------------------------------
// MIME type inference from file extension
// ---------------------------------------------------------------------------

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function inferMimeType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Attachment extraction — reads from disk, routes by MIME
// ---------------------------------------------------------------------------

async function extractAttachments(
  attachmentPaths: string[],
  fixtureDir: string
): Promise<ExtractionResult> {
  const images: ImageAttachment[] = [];
  const docTexts: DocTextAttachment[] = [];
  const errors: string[] = [];

  // Dynamic imports to avoid top-level Node.js module loading issues
  const { extractPdfText, extractDocxText } = await import(
    "@/server/attachments/extract-text"
  );
  const { processImage } = await import(
    "@/server/attachments/process-images"
  );

  for (const relPath of attachmentPaths) {
    const fullPath = path.resolve(fixtureDir, relPath);
    const filename = path.basename(relPath);
    const mime = inferMimeType(filename);

    if (!mime) {
      errors.push(`Unsupported file type: ${filename}`);
      continue;
    }

    if (!fs.existsSync(fullPath)) {
      errors.push(`File not found: ${relPath}`);
      continue;
    }

    const data = fs.readFileSync(fullPath);

    try {
      if (mime === "application/pdf") {
        const result = await extractPdfText(data, filename);
        if (result) docTexts.push(result);
      } else if (
        mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const result = await extractDocxText(data, filename);
        if (result) docTexts.push(result);
      } else if (mime.startsWith("image/")) {
        const result = await processImage(data, mime, filename);
        if (result) images.push(result);
      } else {
        errors.push(`No extractor for MIME type ${mime}: ${filename}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Extraction failed for ${filename}: ${msg}`);
    }
  }

  return {
    images,
    docTexts,
    errors,
    totalAttachmentCount: attachmentPaths.length,
    imageCount: images.length,
  };
}

// ---------------------------------------------------------------------------
// Prompt builder — inline (mirrors prompt-builder.ts, avoids getConfig/Prisma)
// ---------------------------------------------------------------------------

function buildPrompt(
  children: ChildDef[],
  ignoredActivities: string[],
  email: { from: string; subject: string; body: string },
  summaryStyle: SummaryStyle,
  instructions: PromptInstructions,
  docTexts: DocTextAttachment[],
  imageCount: number
): string {
  const summaryInstructions: Record<SummaryStyle, string> = {
    CONCISE: instructions.aiSummaryInstructionConcise,
    STANDARD: instructions.aiSummaryInstructionStandard,
    DETAILED: instructions.aiSummaryInstructionDetailed,
  };

  const lines: string[] = [];

  // System instruction
  lines.push(instructions.aiSystemInstruction);
  lines.push("");

  // Children details
  lines.push("--- CHILDREN ---");
  for (const child of children) {
    lines.push(`Name: ${child.name}`);
    lines.push(`Grade: ${gradeToDescription(child.grade)}`);
    if (child.className) {
      lines.push(`Class: ${child.className}`);
    }
    if (child.teachers.length > 0) {
      lines.push(`Teachers: ${child.teachers.join(", ")}`);
    }
    if (child.additionalInfo) {
      lines.push(`Additional info: ${child.additionalInfo}`);
    }
    lines.push("");
  }

  // Ignored activities
  if (ignoredActivities.length > 0) {
    lines.push("--- IGNORED ACTIVITIES ---");
    lines.push(
      `The family is NOT involved in: ${ignoredActivities.join(", ")}. Ignore emails about these.`
    );
    lines.push("");
  }

  // Email content
  lines.push("--- EMAIL ---");
  lines.push(`From: ${email.from}`);
  lines.push(`Subject: ${email.subject}`);
  lines.push("");
  lines.push(email.body);
  lines.push("");

  // Attached document text
  if (docTexts.length > 0) {
    lines.push("--- ATTACHED DOCUMENTS ---");
    for (const doc of docTexts) {
      lines.push(`[${doc.type.toUpperCase()}: ${doc.filename}]`);
      lines.push(doc.text);
      lines.push("");
    }
  }

  // Note image attachments
  if (imageCount > 0) {
    lines.push(
      `Note: This email has ${imageCount} image attachment(s) that may contain additional information.`
    );
    lines.push("");
  }

  // Response instructions
  lines.push("--- INSTRUCTIONS ---");
  lines.push(instructions.aiResponseFormatInstruction);
  lines.push(instructions.aiRelevanceInstruction);
  lines.push(summaryInstructions[summaryStyle]);
  lines.push(instructions.aiNoSendInstruction);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Direct AI SDK calls
// ---------------------------------------------------------------------------

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

async function callOpenAICompatible(
  config: TestConfig,
  prompt: string,
  images: ImageAttachment[],
  baseURL?: string
): Promise<AICallResult> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: config.aiApiKey, baseURL });

  const useVision = images.length > 0 && config.aiVisionModel !== null;
  const model = useVision ? config.aiVisionModel! : config.aiModel;

  // Build messages
  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "auto" } };

  const content: ContentPart[] = [{ type: "text", text: prompt }];

  if (useVision) {
    for (const img of images) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${img.mediaType};base64,${img.data}`,
          detail: "auto",
        },
      });
    }
  }

  const start = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const durationMs = Date.now() - start;

  const rawResponse = response.choices[0]?.message?.content ?? "";
  const tokensIn = response.usage?.prompt_tokens ?? 0;
  const tokensOut = response.usage?.completion_tokens ?? 0;

  // Parse using the real parser
  const { parseAIResponse } = await import("@/server/ai/response-parser");
  const parsed = parseAIResponse(rawResponse);

  return {
    rawResponse,
    parsed,
    model,
    usedVision: useVision,
    tokensIn,
    tokensOut,
    durationMs,
  };
}

async function callAnthropic(
  config: TestConfig,
  prompt: string,
  images: ImageAttachment[]
): Promise<AICallResult> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: config.aiApiKey });

  const useVision = images.length > 0 && config.aiVisionModel !== null;
  const model = useVision ? config.aiVisionModel! : config.aiModel;

  // Build content blocks
  type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  type ContentBlock =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: ImageMediaType;
          data: string;
        };
      };

  const content: ContentBlock[] = [];

  if (useVision) {
    for (const img of images) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType as ImageMediaType,
          data: img.data,
        },
      });
    }
  }

  content.push({ type: "text", text: prompt });

  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  });
  const durationMs = Date.now() - start;

  const rawResponse =
    response.content[0]?.type === "text" ? response.content[0].text : "";
  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;

  const { parseAIResponse } = await import("@/server/ai/response-parser");
  const parsed = parseAIResponse(rawResponse);

  return {
    rawResponse,
    parsed,
    model,
    usedVision: useVision,
    tokensIn,
    tokensOut,
    durationMs,
  };
}

async function callAI(
  config: TestConfig,
  prompt: string,
  images: ImageAttachment[]
): Promise<AICallResult> {
  if (config.aiProvider === "anthropic") {
    return callAnthropic(config, prompt, images);
  }
  if (config.aiProvider === "gemini") {
    return callOpenAICompatible(config, prompt, images, GEMINI_BASE_URL);
  }
  return callOpenAICompatible(config, prompt, images);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compareResult(
  expected: TestEmailDef["expectedOutcome"],
  actual: AIResponse,
  extraction: ExtractionResult
): ComparisonResult {
  const fields: ComparisonResult["fields"] = {
    send: {
      expected: expected.send,
      actual: actual.send,
      match: expected.send === actual.send,
    },
  };

  let allMatch = fields.send.match;

  // children: null/undefined = skip assertion; string[] = assert exact match
  if (expected.children !== undefined && expected.children !== null) {
    const expSorted = [...expected.children].sort();
    const actSorted = [...(actual.children ?? [])].sort();
    const match =
      expSorted.length === actSorted.length &&
      expSorted.every((v, i) => v === actSorted[i]);
    fields.children = {
      expected: expected.children,
      actual: actual.children ?? [],
      match,
    };
    allMatch = allMatch && match;
  }

  if (expected.attachmentCount !== undefined) {
    fields.attachmentCount = {
      expected: expected.attachmentCount,
      actual: extraction.totalAttachmentCount,
      match: expected.attachmentCount === extraction.totalAttachmentCount,
    };
    allMatch = allMatch && fields.attachmentCount.match;
  }

  if (expected.imageCount !== undefined) {
    fields.imageCount = {
      expected: expected.imageCount,
      actual: extraction.imageCount,
      match: expected.imageCount === extraction.imageCount,
    };
    allMatch = allMatch && fields.imageCount.match;
  }

  return { passed: allMatch, fields };
}

// ---------------------------------------------------------------------------
// Forwarded email rendering
// ---------------------------------------------------------------------------

async function renderForwardedEmail(
  parsed: AIResponse,
  email: TestEmailDef
): Promise<string | null> {
  if (!parsed.send || !parsed.subject || !parsed.summary) return null;

  const { render } = await import("@react-email/components");
  const { ForwardedEmail } = await import(
    "@/server/email/templates/forwarded-email"
  );

  const React = (await import("react")).default;
  const element = React.createElement(ForwardedEmail, {
    summary: parsed.summary,
    subject: parsed.subject,
    originalFrom: email.from,
    originalSubject: email.subject,
    originalBody: email.body,
    originalBodyHtml: email.bodyHtml ?? null,
    childNames: parsed.children ?? [],
    brandName: "SANE",
  });

  return await render(element);
}

// ---------------------------------------------------------------------------
// Process a single test email
// ---------------------------------------------------------------------------

async function processTestEmail(
  email: TestEmailDef,
  config: TestConfig,
  children: ChildDef[],
  ignoredActivities: string[],
  summaryStyle: SummaryStyle,
  instructions: PromptInstructions
): Promise<TestResult> {
  const start = Date.now();

  try {
    // a. Extract attachments from disk
    const extraction = await extractAttachments(
      email.attachments,
      config.fixtureDir
    );

    // b. Build prompt
    const prompt = buildPrompt(
      children,
      ignoredActivities,
      { from: email.from, subject: email.subject, body: email.body },
      summaryStyle,
      instructions,
      extraction.docTexts,
      extraction.imageCount
    );

    // c. Call AI
    const aiResult = await callAI(config, prompt, extraction.images);

    // d. Compare
    const comparison = compareResult(
      email.expectedOutcome,
      aiResult.parsed,
      extraction
    );

    // e. Render forwarded email if send=true
    let forwardedHtml: string | null = null;
    try {
      forwardedHtml = await renderForwardedEmail(aiResult.parsed, email);
    } catch (err) {
      // Non-fatal — log but don't fail the test
      if (config.debug) {
        console.error(
          `  Warning: Failed to render forwarded email: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return {
      email,
      status: comparison.passed ? "pass" : "fail",
      extraction,
      prompt,
      aiResult,
      comparison,
      forwardedHtml,
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      email,
      status: "error",
      extraction: null,
      prompt: null,
      aiResult: null,
      comparison: null,
      forwardedHtml: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log("SANE Pipeline Test Runner");
  console.log("=========================");

  // Load fixture & config
  const cliArgs = parseCLIArgs();
  const { fixture, fixtureDir } = await loadFixture(cliArgs);
  const config = loadTestConfig(fixture, fixtureDir, cliArgs);
  const instructions = getPromptConfig(fixture);

  console.log(
    `Provider: ${config.aiProvider} | Model: ${config.aiModel} | Vision: ${config.aiVisionModel ?? "none"}`
  );
  console.log(
    `Dataset: ${fixture.name}`
  );
  console.log(
    `Emails: ${fixture.emails.length} test cases, ${fixture.children.length} children`
  );
  console.log(
    `Output: ${config.resultsDir}`
  );

  // Ensure results directory
  fs.mkdirSync(config.resultsDir, { recursive: true });

  // Run tests sequentially
  const results: TestResult[] = [];
  for (let i = 0; i < fixture.emails.length; i++) {
    const email = fixture.emails[i];
    const result = await processTestEmail(
      email,
      config,
      fixture.children,
      fixture.ignoredActivities,
      fixture.summaryStyle,
      instructions
    );

    results.push(result);

    // Write artifacts as we go
    writeArtifacts(config.resultsDir, result);

    // Print progress
    printTestProgress(i, fixture.emails.length, result);
  }

  // Build summary
  const summary: RunSummary = {
    timestamp: new Date().toISOString(),
    provider: config.aiProvider,
    model: config.aiModel,
    visionModel: config.aiVisionModel,
    fixtureName: fixture.name,
    totalTests: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    errors: results.filter((r) => r.status === "error").length,
    totalTokensIn: results.reduce(
      (sum, r) => sum + (r.aiResult?.tokensIn ?? 0),
      0
    ),
    totalTokensOut: results.reduce(
      (sum, r) => sum + (r.aiResult?.tokensOut ?? 0),
      0
    ),
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    results,
  };

  // Write outputs
  writeSummaryJson(config.resultsDir, summary);
  writeHtmlReport(config.resultsDir, summary);

  // Print summary
  printSummary(summary, config.resultsDir);

  // Exit with non-zero if any failures
  if (summary.failed > 0 || summary.errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(2);
});
