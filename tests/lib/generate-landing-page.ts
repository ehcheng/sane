/**
 * Landing page generator for unified test reports.
 *
 * Scans the reports directory for:
 *   - unit/results.json    (unit test results)
 *   - {dataset}/summary.json  (pipeline test results, any subfolder with report.html)
 *
 * Generates an index.html with clickable cards linking to each report.
 *
 * Usage: tsx tests/lib/generate-landing-page.ts <reports-dir>
 */

import * as fs from "fs";
import * as path from "path";

interface UnitResults {
  timestamp: string;
  duration: number;
  totals: { total: number; passed: number; failed: number; skipped: number };
}

interface PipelineSummary {
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
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function generateLandingPage(reportsDir: string): void {
  const unitReportPath = path.join(reportsDir, "unit", "index.html");
  const unitJsonPath = path.join(reportsDir, "unit", "results.json");
  const pipelineReportPath = path.join(reportsDir, "report.html");
  const pipelineJsonPath = path.join(reportsDir, "summary.json");

  const hasUnit = fs.existsSync(unitReportPath);
  const hasPipeline = fs.existsSync(pipelineReportPath);

  if (!hasUnit && !hasPipeline) {
    console.log("No reports found — skipping landing page generation.");
    return;
  }

  let unitData: UnitResults | null = null;
  if (hasUnit && fs.existsSync(unitJsonPath)) {
    unitData = JSON.parse(fs.readFileSync(unitJsonPath, "utf-8"));
  }

  let pipelineData: PipelineSummary | null = null;
  if (hasPipeline && fs.existsSync(pipelineJsonPath)) {
    pipelineData = JSON.parse(fs.readFileSync(pipelineJsonPath, "utf-8"));
  }

  const dirName = path.basename(reportsDir);
  const html = buildHtml(dirName, hasUnit, unitData, hasPipeline, pipelineData);

  fs.writeFileSync(path.join(reportsDir, "index.html"), html, "utf-8");
}

function buildHtml(
  dirName: string,
  hasUnit: boolean,
  unitData: UnitResults | null,
  hasPipeline: boolean,
  pipelineData: PipelineSummary | null
): string {
  const cards: string[] = [];

  if (hasUnit) {
    const t = unitData?.totals;
    const allPassed = t ? t.failed === 0 : true;
    const borderColor = allPassed ? "#22c55e" : "#ef4444";
    const statsHtml = t
      ? `<div class="card-stats">
           <span class="stat-pass">${t.passed} passed</span>
           ${t.failed > 0 ? `<span class="stat-fail">${t.failed} failed</span>` : ""}
           ${t.skipped > 0 ? `<span class="stat-skip">${t.skipped} skipped</span>` : ""}
           <span class="stat-neutral">${t.total} total</span>
         </div>
         <div class="card-meta">${fmtDuration(unitData!.duration)}</div>`
      : `<div class="card-meta">Report available</div>`;

    cards.push(`
    <a href="unit/index.html" class="card" style="border-left-color: ${borderColor}">
      <div class="card-icon">&#x1F9EA;</div>
      <div class="card-body">
        <h2>Unit Tests</h2>
        ${statsHtml}
      </div>
    </a>`);
  }

  if (hasPipeline) {
    const p = pipelineData;
    const displayName = p?.fixtureName ?? "Pipeline Tests";
    const allPassed = p ? p.failed === 0 && p.errors === 0 : true;
    const borderColor = allPassed ? "#22c55e" : "#ef4444";
    const statsHtml = p
      ? `<div class="card-stats">
           <span class="stat-pass">${p.passed} passed</span>
           ${p.failed > 0 ? `<span class="stat-fail">${p.failed} failed</span>` : ""}
           ${p.errors > 0 ? `<span class="stat-error">${p.errors} errors</span>` : ""}
           <span class="stat-neutral">${p.totalTests} total</span>
         </div>
         <div class="card-meta">
           ${esc(p.provider)} / ${esc(p.model)} &middot;
           ${p.totalTokensIn.toLocaleString()} in / ${p.totalTokensOut.toLocaleString()} out &middot;
           ${fmtDuration(p.totalDurationMs)}
         </div>`
      : `<div class="card-meta">Report available</div>`;

    cards.push(`
    <a href="report.html" class="card" style="border-left-color: ${borderColor}">
      <div class="card-icon">&#x1F916;</div>
      <div class="card-body">
        <h2>${esc(displayName)}</h2>
        ${statsHtml}
      </div>
    </a>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SANE Test Reports — ${esc(dirName)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.5; }
.container { max-width: 600px; margin: 0 auto; padding: 48px 16px; }
h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
.subtitle { color: #64748b; font-size: 14px; margin-bottom: 32px; }

.card { display: flex; align-items: flex-start; gap: 16px; background: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-left: 4px solid #cbd5e1; text-decoration: none; color: inherit; transition: box-shadow 0.15s, transform 0.15s; }
.card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); transform: translateY(-1px); }
.card-icon { font-size: 28px; line-height: 1; flex-shrink: 0; margin-top: 2px; }
.card-body { flex: 1; }
.card-body h2 { font-size: 17px; font-weight: 600; margin-bottom: 6px; }
.card-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.card-stats span { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.stat-pass { background: #dcfce7; color: #166534; }
.stat-fail { background: #fee2e2; color: #991b1b; }
.stat-error { background: #fef9c3; color: #854d0e; }
.stat-skip { background: #f1f5f9; color: #64748b; }
.stat-neutral { background: #f1f5f9; color: #475569; }
.card-meta { font-size: 12px; color: #64748b; }
</style>
</head>
<body>
<div class="container">
  <h1>SANE Test Reports</h1>
  <div class="subtitle">${esc(dirName)}</div>
  ${cards.join("\n")}
</div>
</body>
</html>`;
}

// CLI entry point
if (require.main === module || process.argv[1]?.endsWith("generate-landing-page.ts")) {
  const reportsDir = process.argv[2];
  if (!reportsDir) {
    console.error("Usage: tsx tests/lib/generate-landing-page.ts <reports-dir>");
    process.exit(1);
  }
  generateLandingPage(path.resolve(reportsDir));
}
