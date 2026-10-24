// ---------------------------------------------------------------------------
// Attachment Pipeline Test — Configuration
//
// Loads test data from a dataset directory containing:
//   sample-emails.json     — email fixtures (with date tokens)
//   expected-outcomes.json  — expected AI results per email ID
//
// User config (children, AI config, prompt instructions) is loaded from
// sane-test-fixture.json in the parent directory.
//
// Also supports legacy single-file fixtures for backward compatibility.
//
// Usage:
//   npm run test:pipeline -- <dataset-dir> [--output <dir>]
//   npm run test:pipeline -- path/to/legacy-fixture.json
// ---------------------------------------------------------------------------

import * as path from "path";
import * as fs from "fs";
import { config as loadDotenv } from "dotenv";
import { DEFAULTS } from "../../app.config.defaults";
import type { TestFixture, TestConfig, PromptInstructions } from "./types";

const TEST_DIR = path.resolve(__dirname);

/** Load .env from the test directory */
loadDotenv({ path: path.join(TEST_DIR, ".env") });

// ---------------------------------------------------------------------------
// Date token resolver (imported from test-fixtures)
// ---------------------------------------------------------------------------

const RESOLVE_DATES_PATH = path.resolve(
  __dirname,
  "../../_github_excluded/test-fixtures/resolve-dates.ts"
);

let _resolveDateTokens: ((text: string, baseDate?: Date) => string) | null = null;

async function getResolver(): Promise<(text: string, baseDate?: Date) => string> {
  if (_resolveDateTokens) return _resolveDateTokens;
  try {
    const mod = await import(RESOLVE_DATES_PATH);
    _resolveDateTokens = mod.resolveDateTokens;
    return _resolveDateTokens!;
  } catch {
    // Fallback: no-op if resolver not available
    console.warn("Warning: resolve-dates.ts not found — date tokens will not be resolved");
    _resolveDateTokens = (text: string) => text;
    return _resolveDateTokens;
  }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function padId(id: number | string): string {
  const num = typeof id === "number" ? id : parseInt(id, 10);
  if (!isNaN(num) && num < 100) return String(num).padStart(2, "0");
  return String(id);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface CLIArgs {
  /** Path to dataset dir or legacy fixture file */
  target: string;
  /** Custom output directory (null = use default) */
  outputDir: string | null;
}

export function parseCLIArgs(): CLIArgs {
  const args = process.argv.slice(2);
  let target: string | null = null;
  let outputDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      outputDir = args[++i];
      if (!outputDir) {
        throw new Error("--output requires a directory path");
      }
    } else if (!args[i].startsWith("-")) {
      target = args[i];
    }
  }

  if (!target) {
    // Default: look for fixture.json in the test dir (legacy)
    target = path.join(TEST_DIR, "fixture.json");
  }

  return { target: path.resolve(target), outputDir: outputDir ? path.resolve(outputDir) : null };
}

// ---------------------------------------------------------------------------
// Dataset directory detection
// ---------------------------------------------------------------------------

function isDatasetDir(targetPath: string): boolean {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    return false;
  }
  return fs.existsSync(path.join(targetPath, "sample-emails.json"));
}

// ---------------------------------------------------------------------------
// New-style loading: dataset directory
// ---------------------------------------------------------------------------

async function loadFromDatasetDir(datasetDir: string): Promise<{
  fixture: TestFixture;
  fixtureDir: string;
}> {
  const resolve = await getResolver();

  // Load sample-emails.json
  const emailsPath = path.join(datasetDir, "sample-emails.json");
  if (!fs.existsSync(emailsPath)) {
    throw new Error(`sample-emails.json not found in ${datasetDir}`);
  }
  const rawEmailsText = resolve(fs.readFileSync(emailsPath, "utf-8"));
  const rawEmails = JSON.parse(rawEmailsText);

  // Load expected-outcomes.json
  const outcomesPath = path.join(datasetDir, "expected-outcomes.json");
  if (!fs.existsSync(outcomesPath)) {
    throw new Error(`expected-outcomes.json not found in ${datasetDir}`);
  }
  const rawOutcomes = JSON.parse(fs.readFileSync(outcomesPath, "utf-8"));
  const outcomes: Record<string, Record<string, unknown>> = rawOutcomes.outcomes ?? {};

  // Load user config from parent directory
  const parentDir = path.dirname(datasetDir);
  const userConfigPath = path.join(parentDir, "sane-test-fixture.json");
  if (!fs.existsSync(userConfigPath)) {
    throw new Error(
      `sane-test-fixture.json not found in ${parentDir}\n` +
      `The user config file must be in the parent directory of the dataset.`
    );
  }
  const rawUserConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf-8"));

  // Merge emails with their expected outcomes
  const emails = (rawEmails.emails as Record<string, unknown>[]).map((e) => {
    const id = padId(e.id as number | string);
    const idKey = String(e.id); // outcomes use unpadded keys
    const subject = e.subject as string;
    const slug = (e.slug as string) ?? slugify(subject);
    const outcome = outcomes[idKey] ?? {};

    return {
      id,
      slug,
      description: e.description as string | undefined,
      from: e.from as string,
      to: e.to as string | undefined,
      subject,
      body: e.body as string,
      bodyHtml: (e.bodyHtml as string) ?? null,
      attachments: (e.attachments as string[]) ?? [],
      receivedAt: (e.receivedAt as string) ?? null,
      expectedOutcome: {
        send: outcome.send as boolean,
        children: outcome.children as string[] | null | undefined,
        attachmentCount: outcome.attachmentCount as number | undefined,
        imageCount: outcome.imageCount as number | undefined,
        notes: (outcome.reasoning as string) ?? (outcome.notes as string) ?? undefined,
      },
      attachmentTypes: e.attachmentTypes as Record<string, number> | undefined,
    };
  });

  // Normalize prompt instructions
  const rawInstructions = (rawUserConfig.promptInstructions ?? {}) as Record<string, string>;
  const promptInstructions = normalizePromptInstructions(rawInstructions);

  // Summary style
  const rawStyle =
    (rawUserConfig.summaryStyle as string) ??
    (rawUserConfig.user?.summaryStyle as string) ??
    "CONCISE";
  const summaryStyle = rawStyle.toUpperCase() as TestFixture["summaryStyle"];

  const fixture: TestFixture = {
    name: (rawEmails.name as string) ?? path.basename(datasetDir),
    description: rawEmails.description as string | undefined,
    user: rawUserConfig.user as TestFixture["user"],
    aiConfig: rawUserConfig.aiConfig as TestFixture["aiConfig"],
    promptInstructions,
    children: rawUserConfig.children as TestFixture["children"],
    ignoredActivities: (rawUserConfig.ignoredActivities as string[]) ?? [],
    summaryStyle,
    emails,
    forwardingAddresses: rawUserConfig.forwardingAddresses as unknown[],
  };

  return { fixture, fixtureDir: datasetDir };
}

// ---------------------------------------------------------------------------
// Legacy loading: single fixture JSON (backward compat)
// ---------------------------------------------------------------------------

function loadFromLegacyFixture(fixturePath: string): {
  fixture: TestFixture;
  fixtureDir: string;
} {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `Fixture not found: ${fixturePath}\n` +
        `Usage: npm run test:pipeline -- <dataset-dir> [--output <dir>]\n` +
        `       npm run test:pipeline -- <path/to/fixture.json>`
    );
  }

  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  return {
    fixture: normalizeLegacyFixture(raw, fixturePath),
    fixtureDir: path.dirname(fixturePath),
  };
}

function normalizeLegacyFixture(
  raw: Record<string, unknown>,
  fixturePath: string
): TestFixture {
  const name =
    (raw.name as string) ??
    (raw.description as string)?.slice(0, 60) ??
    path.basename(fixturePath, ".json");

  const user = raw.user as Record<string, unknown> | undefined;
  const rawStyle =
    (raw.summaryStyle as string) ??
    (user?.summaryStyle as string) ??
    "CONCISE";
  const summaryStyle = rawStyle.toUpperCase() as TestFixture["summaryStyle"];

  const rawEmails = (raw.emails ?? raw.testEmails) as Record<string, unknown>[];
  if (!rawEmails || !Array.isArray(rawEmails)) {
    throw new Error('Fixture must have an "emails" or "testEmails" array');
  }

  const emails = rawEmails.map((e) => {
    const id = padId(e.id as number | string);
    const subject = e.subject as string;
    const slug = (e.slug as string) ?? slugify(subject);

    const expectedOutcome =
      (e.expectedOutcome as Record<string, unknown>) ??
      (e.expected as Record<string, unknown>) ??
      {};

    return {
      id,
      slug,
      description: e.description as string | undefined,
      from: e.from as string,
      to: e.to as string | undefined,
      subject,
      body: e.body as string,
      bodyHtml: (e.bodyHtml as string) ?? null,
      attachments: (e.attachments as string[]) ?? [],
      receivedAt: null as string | null,
      expectedOutcome: {
        send: expectedOutcome.send as boolean,
        children: expectedOutcome.children as string[] | null | undefined,
        attachmentCount: expectedOutcome.attachmentCount as number | undefined,
        imageCount: expectedOutcome.imageCount as number | undefined,
        notes: expectedOutcome.notes as string | undefined,
      },
      attachmentTypes: e.attachmentTypes as Record<string, number> | undefined,
    };
  });

  const rawInstructions = (raw.promptInstructions ?? {}) as Record<string, string>;
  const promptInstructions = normalizePromptInstructions(rawInstructions);

  return {
    name,
    description: raw.description as string | undefined,
    user: user as TestFixture["user"],
    aiConfig: raw.aiConfig as TestFixture["aiConfig"],
    promptInstructions,
    children: raw.children as TestFixture["children"],
    ignoredActivities: (raw.ignoredActivities as string[]) ?? [],
    summaryStyle,
    emails,
    forwardingAddresses: raw.forwardingAddresses as unknown[],
    testCoverage: raw.testCoverage,
  };
}

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

function normalizePromptInstructions(
  rawInstructions: Record<string, string>
): Partial<PromptInstructions> {
  const result: Partial<PromptInstructions> = {};

  const keyMap: Record<string, keyof PromptInstructions> = {
    system: "aiSystemInstruction",
    aiSystemInstruction: "aiSystemInstruction",
    relevance: "aiRelevanceInstruction",
    aiRelevanceInstruction: "aiRelevanceInstruction",
    summaryConcise: "aiSummaryInstructionConcise",
    aiSummaryInstructionConcise: "aiSummaryInstructionConcise",
    summaryStandard: "aiSummaryInstructionStandard",
    aiSummaryInstructionStandard: "aiSummaryInstructionStandard",
    summaryDetailed: "aiSummaryInstructionDetailed",
    aiSummaryInstructionDetailed: "aiSummaryInstructionDetailed",
    responseFormat: "aiResponseFormatInstruction",
    aiResponseFormatInstruction: "aiResponseFormatInstruction",
    noSend: "aiNoSendInstruction",
    aiNoSendInstruction: "aiNoSendInstruction",
  };

  for (const [key, value] of Object.entries(rawInstructions)) {
    const canonical = keyMap[key];
    if (canonical && value) {
      result[canonical] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the test fixture from CLI args.
 * Supports both new dataset-dir format and legacy single-file format.
 */
export async function loadFixture(cliArgs: CLIArgs): Promise<{
  fixture: TestFixture;
  fixtureDir: string;
}> {
  if (isDatasetDir(cliArgs.target)) {
    return loadFromDatasetDir(cliArgs.target);
  }
  return loadFromLegacyFixture(cliArgs.target);
}

/**
 * Build test configuration from env vars, fixture aiConfig, and defaults.
 * Priority: env var > fixture > default.
 */
export function loadTestConfig(
  fixture: TestFixture,
  fixtureDir: string,
  cliArgs: CLIArgs
): TestConfig {
  const aiApiKey =
    process.env.AI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.GOOGLE_AI_API_KEY ??
    process.env.GEMINI_API_KEY;

  if (!aiApiKey) {
    throw new Error(
      "No API key found. Set AI_API_KEY (or GOOGLE_AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY) in tests/attachment-pipeline/.env"
    );
  }

  const provider = (
    process.env.AI_PROVIDER ??
    fixture.aiConfig?.provider ??
    "openai"
  ) as TestConfig["aiProvider"];

  const model =
    process.env.AI_MODEL ?? fixture.aiConfig?.model ?? (provider === "gemini" ? "gemini-3.8-flash" : "gpt-4.1");

  const visionModelRaw =
    process.env.AI_VISION_MODEL ?? fixture.aiConfig?.visionModel ?? "";
  const visionModel = visionModelRaw || null;

  // Results directory: --output flag > default (timestamped subdir in dataset dir)
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);

  const resultsDir = cliArgs.outputDir ?? path.join(fixtureDir, "results", timestamp);

  const debug = process.env.DEBUG === "true";

  return {
    aiApiKey,
    aiProvider: provider,
    aiModel: model,
    aiVisionModel: visionModel,
    fixtureDir,
    resultsDir,
    debug,
  };
}

/**
 * Build prompt instructions by merging fixture overrides with DEFAULTS.
 */
export function getPromptConfig(
  fixture: TestFixture
): PromptInstructions {
  const overrides = fixture.promptInstructions ?? {};
  return {
    aiSystemInstruction:
      overrides.aiSystemInstruction ?? DEFAULTS.aiSystemInstruction,
    aiRelevanceInstruction:
      overrides.aiRelevanceInstruction ?? DEFAULTS.aiRelevanceInstruction,
    aiSummaryInstructionConcise:
      overrides.aiSummaryInstructionConcise ??
      DEFAULTS.aiSummaryInstructionConcise,
    aiSummaryInstructionStandard:
      overrides.aiSummaryInstructionStandard ??
      DEFAULTS.aiSummaryInstructionStandard,
    aiSummaryInstructionDetailed:
      overrides.aiSummaryInstructionDetailed ??
      DEFAULTS.aiSummaryInstructionDetailed,
    aiResponseFormatInstruction:
      overrides.aiResponseFormatInstruction ??
      DEFAULTS.aiResponseFormatInstruction,
    aiNoSendInstruction:
      overrides.aiNoSendInstruction ?? DEFAULTS.aiNoSendInstruction,
  };
}
