/**
 * Orchestrator for running all test suites with a shared timestamp.
 *
 * 1. Generates a shared timestamp for the report directory
 * 2. Runs unit tests via vitest (always)
 * 3. Runs pipeline tests if an AI API key is available
 * 4. Generates a landing page linking both reports
 * 5. Captures all output to a log file in the report directory
 * 6. Exits with combined status code
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateTimestamp } from "./timestamp";
import { generateLandingPage } from "./generate-landing-page";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES_DIR = path.join(ROOT, "_github_excluded", "test-fixtures");
const DEFAULT_DATASET = path.join(FIXTURES_DIR, "03_sample_emails");
const timestamp = generateTimestamp();

// Determine dataset early so the folder name includes it
const dataset = process.env.PIPELINE_DATASET ?? DEFAULT_DATASET;
const datasetName = path.basename(dataset);
const willRunPipeline = !!(
  process.env.AI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.GOOGLE_AI_API_KEY ||
  process.env.GEMINI_API_KEY
);
const dirName = willRunPipeline ? `${timestamp}_${datasetName}` : timestamp;
const reportsDir = path.join(ROOT, "test-reports", dirName);

// Ensure reports dir exists before anything writes to it
fs.mkdirSync(reportsDir, { recursive: true });

const logPath = path.join(reportsDir, "test-run.log");
let logFd: number;

function log(msg: string): void {
  const line = msg + "\n";
  process.stdout.write(line);
  fs.writeSync(logFd, line);
}


function run(cmd: string, label: string): boolean {
  log(`\n--- ${label} ---\n`);
  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      env: { ...process.env, TEST_TIMESTAMP: dirName },
      encoding: "utf-8",
      // Capture both stdout and stderr together
      stdio: ["inherit", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    // Write to terminal and log
    if (output) {
      process.stdout.write(output);
      fs.writeSync(logFd, output);
    }
    return true;
  } catch (err: unknown) {
    // execSync throws on non-zero exit — capture whatever output was produced
    const execErr = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    const stdout = execErr.stdout?.toString() ?? "";
    const stderr = execErr.stderr?.toString() ?? "";

    if (stdout) {
      process.stdout.write(stdout);
      fs.writeSync(logFd, stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
      fs.writeSync(logFd, `\n--- STDERR ---\n${stderr}`);
    }
    log(`\n[${label}] exited with code ${execErr.status ?? "unknown"}`);
    return false;
  }
}

function main(): void {
  logFd = fs.openSync(logPath, "w");

  log(`SANE Test Suite`);
  log(`Reports: test-reports/${dirName}/`);
  log(`Log:     ${logPath}`);

  // 1. Unit tests (always)
  const unitPassed = run("npx vitest run", "Unit Tests");

  // 2. Pipeline tests (if API key available)
  let pipelinePassed = true;
  let pipelineSkipped = false;

  if (willRunPipeline) {
    pipelinePassed = run(
      `npx tsx --tsconfig tsconfig.json tests/attachment-pipeline/run.ts ${dataset} --output ${reportsDir}`,
      `Pipeline: ${datasetName}`
    );
  } else {
    pipelineSkipped = true;
    log("\n--- Pipeline Tests SKIPPED (no AI_API_KEY) ---\n");
  }

  // 3. Generate landing page
  generateLandingPage(reportsDir);

  // 4. Summary
  log(`\n${"=".repeat(40)}`);
  log(`Unit:     ${unitPassed ? "PASSED" : "FAILED"}`);
  log(
    `Pipeline: ${pipelineSkipped ? "SKIPPED" : pipelinePassed ? "PASSED" : "FAILED"}`
  );
  log(`Report:   ${path.join(reportsDir, "index.html")}`);
  log(`Log:      ${logPath}`);
  log(`${"=".repeat(40)}\n`);

  fs.closeSync(logFd);

  // Exit with non-zero if anything failed
  if (!unitPassed || !pipelinePassed) {
    process.exit(1);
  }
}

main();
