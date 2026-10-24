/**
 * SaneHtmlReporter — Custom Vitest v4 reporter that generates self-contained
 * HTML test reports with structured JSON output.
 *
 * Unlike the built-in HTML reporter, this shows per-test detail: error messages,
 * expected vs actual values, diffs, and duration — all in a single file with
 * inline CSS (no external dependencies).
 */

import * as fs from "fs";
import * as path from "path";
import type { Reporter } from "vitest/reporters";
import type { TestCase, TestModule, TestSuite } from "vitest/node";

// ---------------------------------------------------------------------------
// Types for collected data
// ---------------------------------------------------------------------------

interface CollectedTest {
  name: string;
  fullName: string;
  state: "passed" | "failed" | "skipped" | "pending";
  duration: number;
  suitePath: string[];
  errors: CollectedError[];
}

interface CollectedError {
  message: string;
  expected?: string;
  actual?: string;
  diff?: string;
}

interface CollectedModule {
  relativeId: string;
  tests: CollectedTest[];
  duration: number;
}

interface ResultsJson {
  timestamp: string;
  duration: number;
  totals: { total: number; passed: number; failed: number; skipped: number };
  modules: {
    file: string;
    duration: number;
    tests: {
      name: string;
      fullName: string;
      state: string;
      duration: number;
      suitePath: string[];
      errors: CollectedError[];
    }[];
  }[];
}

// ---------------------------------------------------------------------------
// Reporter options
// ---------------------------------------------------------------------------

export interface SaneHtmlReporterOptions {
  resultsDir: string;
}

// ---------------------------------------------------------------------------
// Reporter implementation
// ---------------------------------------------------------------------------

export class SaneHtmlReporter implements Reporter {
  private options: SaneHtmlReporterOptions;
  private modules: Map<string, CollectedModule> = new Map();
  private startTime: number = 0;

  constructor(options: SaneHtmlReporterOptions) {
    this.options = options;
  }

  onTestRunStart(): void {
    this.startTime = Date.now();
    this.modules.clear();
  }

  onTestCaseResult(testCase: TestCase): void {
    const moduleId = testCase.module.moduleId;
    const relativeId = testCase.module.relativeModuleId;

    if (!this.modules.has(moduleId)) {
      this.modules.set(moduleId, {
        relativeId,
        tests: [],
        duration: 0,
      });
    }

    const result = testCase.result();
    const diag = testCase.diagnostic();

    // Build suite path by walking parent chain
    const suitePath: string[] = [];
    let parent: TestSuite | TestModule = testCase.parent;
    while (parent && parent.type === "suite") {
      suitePath.unshift(parent.name);
      parent = parent.parent;
    }

    // Collect errors for failed tests
    const errors: CollectedError[] = [];
    if (result.state === "failed" && result.errors) {
      for (const err of result.errors) {
        errors.push({
          message: err.message,
          expected: err.expected,
          actual: err.actual,
          diff: err.diff,
        });
      }
    }

    this.modules.get(moduleId)!.tests.push({
      name: testCase.name,
      fullName: testCase.fullName,
      state: result.state,
      duration: diag?.duration ?? 0,
      suitePath,
      errors,
    });
  }

  onTestModuleEnd(testModule: TestModule): void {
    const mod = this.modules.get(testModule.moduleId);
    if (mod) {
      const diag = testModule.diagnostic();
      mod.duration = diag?.duration ?? 0;
    }
  }

  onTestRunEnd(): void {
    const totalDuration = Date.now() - this.startTime;

    // Flatten all tests for stats
    const allTests: CollectedTest[] = [];
    for (const mod of Array.from(this.modules.values())) {
      allTests.push(...mod.tests);
    }

    const totals = {
      total: allTests.length,
      passed: allTests.filter((t) => t.state === "passed").length,
      failed: allTests.filter((t) => t.state === "failed").length,
      skipped: allTests.filter(
        (t) => t.state === "skipped" || t.state === "pending"
      ).length,
    };

    const timestamp = new Date().toISOString();

    // Build structured data
    const modulesData = Array.from(this.modules.values()).map((mod) => ({
      file: mod.relativeId,
      duration: mod.duration,
      tests: mod.tests.map((t) => ({
        name: t.name,
        fullName: t.fullName,
        state: t.state,
        duration: t.duration,
        suitePath: t.suitePath,
        errors: t.errors,
      })),
    }));

    const resultsJson: ResultsJson = {
      timestamp,
      duration: totalDuration,
      totals,
      modules: modulesData,
    };

    // Write output
    fs.mkdirSync(this.options.resultsDir, { recursive: true });

    fs.writeFileSync(
      path.join(this.options.resultsDir, "results.json"),
      JSON.stringify(resultsJson, null, 2),
      "utf-8"
    );

    const html = generateHtml(resultsJson);
    fs.writeFileSync(
      path.join(this.options.resultsDir, "index.html"),
      html,
      "utf-8"
    );
  }
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function generateHtml(data: ResultsJson): string {
  const { totals, duration } = data;
  const passRate =
    totals.total > 0
      ? Math.round((totals.passed / totals.total) * 100)
      : 0;

  const ts = new Date(data.timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  });

  // Progress bar — one segment per test
  const allTests = data.modules.flatMap((m) => m.tests);
  const barSegments = allTests
    .map((t) => {
      const color =
        t.state === "passed"
          ? "#22c55e"
          : t.state === "failed"
            ? "#ef4444"
            : "#94a3b8";
      return `<div style="flex:1;height:8px;background:${color};"></div>`;
    })
    .join("");

  // Module sections
  const moduleSections = data.modules.map((mod) => renderModule(mod)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SANE Unit Test Report</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.5; }
.container { max-width: 900px; margin: 0 auto; padding: 24px 16px; }

/* Dashboard */
.dashboard { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.dashboard h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.dashboard .meta { color: #64748b; font-size: 13px; margin-bottom: 16px; }
.stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.stat { padding: 8px 14px; border-radius: 8px; font-size: 14px; font-weight: 600; }
.stat-pass { background: #dcfce7; color: #166534; }
.stat-fail { background: #fee2e2; color: #991b1b; }
.stat-skip { background: #f1f5f9; color: #475569; }
.stat-neutral { background: #f1f5f9; color: #475569; }
.bar { display: flex; gap: 2px; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
.rate { font-size: 13px; color: #64748b; }

/* Module sections */
.module { background: #fff; border-radius: 10px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); overflow: hidden; }
.module > summary { padding: 14px 18px; font-size: 14px; font-weight: 600; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 10px; list-style: none; }
.module > summary::-webkit-details-marker { display: none; }
.module > summary::before { content: "\\25B6"; font-size: 10px; color: #94a3b8; transition: transform 0.15s; }
.module[open] > summary::before { transform: rotate(90deg); }
.module > summary:hover { background: #f8fafc; }
.module-file { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.module-stats { font-size: 12px; color: #64748b; font-weight: 400; white-space: nowrap; }
.module-content { padding: 0 18px 14px; }

/* Suite groups */
.suite-label { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 0 6px; border-bottom: 1px solid #f1f5f9; margin-bottom: 6px; }

/* Test rows */
.test-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f8fafc; }
.test-row:last-child { border-bottom: none; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; margin-top: 2px; }
.badge-passed { background: #dcfce7; color: #166534; }
.badge-failed { background: #fee2e2; color: #991b1b; }
.badge-skipped { background: #f1f5f9; color: #64748b; }
.badge-pending { background: #f1f5f9; color: #64748b; }
.test-name { flex: 1; font-size: 13px; }
.test-duration { font-size: 11px; color: #94a3b8; flex-shrink: 0; margin-top: 2px; }

/* Error details */
.error-block { margin: 4px 0 8px 38px; }
.error-message { font-size: 12px; color: #991b1b; margin-bottom: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
.diff-block { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto; }
.expected-actual { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-bottom: 6px; }
.ea-label { font-weight: 600; color: #64748b; }
.ea-expected { color: #166534; }
.ea-actual { color: #991b1b; }
</style>
</head>
<body>
<div class="container">

<div class="dashboard">
  <h1>SANE Unit Test Report</h1>
  <div class="meta">${esc(ts)} &middot; ${fmtDuration(duration)}</div>
  <div class="stats">
    <span class="stat stat-pass">${totals.passed} passed</span>
    ${totals.failed > 0 ? `<span class="stat stat-fail">${totals.failed} failed</span>` : ""}
    ${totals.skipped > 0 ? `<span class="stat stat-skip">${totals.skipped} skipped</span>` : ""}
    <span class="stat stat-neutral">${totals.total} total</span>
  </div>
  <div class="bar">${barSegments}</div>
  <div class="rate">${passRate}% pass rate (${totals.passed}/${totals.total})</div>
</div>

${moduleSections}

</div>
</body>
</html>`;
}

function renderModule(mod: ResultsJson["modules"][number]): string {
  const hasFail = mod.tests.some((t) => t.state === "failed");
  const passCount = mod.tests.filter((t) => t.state === "passed").length;
  const failCount = mod.tests.filter((t) => t.state === "failed").length;
  const skipCount = mod.tests.filter(
    (t) => t.state === "skipped" || t.state === "pending"
  ).length;

  const statsHtml = [
    passCount > 0 ? `<span style="color:#166534">${passCount} passed</span>` : "",
    failCount > 0 ? `<span style="color:#991b1b">${failCount} failed</span>` : "",
    skipCount > 0 ? `<span style="color:#64748b">${skipCount} skipped</span>` : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");

  // Group tests by suite path
  const grouped = groupBySuite(mod.tests);
  const testsHtml = renderSuiteGroup(grouped);

  // Auto-expand if there are failures
  return `
<details class="module"${hasFail ? " open" : ""}>
  <summary>
    <span class="module-file">${esc(mod.file)}</span>
    <span class="module-stats">${statsHtml} &middot; ${fmtDuration(mod.duration)}</span>
  </summary>
  <div class="module-content">
    ${testsHtml}
  </div>
</details>`;
}

interface SuiteGroup {
  label: string | null;
  tests: ResultsJson["modules"][number]["tests"][number][];
  children: Map<string, SuiteGroup>;
}

function groupBySuite(
  tests: ResultsJson["modules"][number]["tests"]
): SuiteGroup {
  const root: SuiteGroup = { label: null, tests: [], children: new Map() };

  for (const test of tests) {
    let current = root;
    for (const suite of test.suitePath) {
      if (!current.children.has(suite)) {
        current.children.set(suite, {
          label: suite,
          tests: [],
          children: new Map(),
        });
      }
      current = current.children.get(suite)!;
    }
    current.tests.push(test);
  }

  return root;
}

function renderSuiteGroup(group: SuiteGroup, depth: number = 0): string {
  let html = "";

  // Render label if not root
  if (group.label) {
    const indent = depth > 1 ? `margin-left: ${(depth - 1) * 16}px;` : "";
    html += `<div class="suite-label" style="${indent}">${esc(group.label)}</div>`;
  }

  // Render direct tests
  for (const test of group.tests) {
    html += renderTest(test, depth);
  }

  // Render child suites
  for (const child of Array.from(group.children.values())) {
    html += renderSuiteGroup(child, depth + 1);
  }

  return html;
}

function renderTest(
  test: ResultsJson["modules"][number]["tests"][number],
  depth: number
): string {
  const badgeClass = `badge-${test.state}`;
  const badgeLabel =
    test.state === "passed"
      ? "PASS"
      : test.state === "failed"
        ? "FAIL"
        : "SKIP";

  const indent = depth > 0 ? `padding-left: ${depth * 16}px;` : "";

  let html = `
<div class="test-row" style="${indent}">
  <span class="badge ${badgeClass}">${badgeLabel}</span>
  <span class="test-name">${esc(test.name)}</span>
  <span class="test-duration">${fmtDuration(test.duration)}</span>
</div>`;

  // Show error details for failed tests
  if (test.state === "failed" && test.errors.length > 0) {
    for (const err of test.errors) {
      html += `<div class="error-block">`;
      html += `<div class="error-message">${esc(err.message)}</div>`;

      if (err.expected !== undefined || err.actual !== undefined) {
        html += `<div class="expected-actual">`;
        if (err.expected !== undefined) {
          html += `<span class="ea-label">Expected:</span><span class="ea-expected">${esc(err.expected)}</span>`;
        }
        if (err.actual !== undefined) {
          html += `<span class="ea-label">Actual:</span><span class="ea-actual">${esc(err.actual)}</span>`;
        }
        html += `</div>`;
      }

      if (err.diff) {
        html += `<div class="diff-block">${esc(err.diff)}</div>`;
      }

      html += `</div>`;
    }
  }

  return html;
}
