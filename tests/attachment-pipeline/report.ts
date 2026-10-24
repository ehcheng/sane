// ---------------------------------------------------------------------------
// Attachment Pipeline Test — Report Generator
// ---------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";
import type { TestResult, RunSummary, ComparisonResult } from "./types";

// ---- Console Output ----

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

export function printTestProgress(
  index: number,
  total: number,
  result: TestResult
): void {
  const num = `[${index + 1}/${total}]`;
  const subject = result.email.subject;

  if (result.status === "error") {
    console.log(`\n${num} ${subject}`);
    console.log(`  ${RED}ERROR: ${result.error}${RESET}`);
    return;
  }

  console.log(`\n${num} ${subject}`);

  // Attachment info
  if (result.extraction) {
    const { docTexts, images, errors } = result.extraction;
    const parts: string[] = [];
    for (const doc of docTexts) {
      parts.push(
        `${doc.type.toUpperCase()} → ${doc.text.length.toLocaleString()} chars`
      );
    }
    for (const img of images) {
      const sizeKB = (img.sizeBytes / 1024).toFixed(1);
      parts.push(`${img.mediaType} (${sizeKB}KB)`);
    }
    if (errors.length > 0) {
      parts.push(`${errors.length} error(s)`);
    }
    if (parts.length > 0) {
      console.log(`  Attachments: ${parts.join(", ")}`);
    }
  }

  // AI info
  if (result.aiResult) {
    const ai = result.aiResult;
    const visionTag = ai.usedVision ? "vision" : "text";
    const noVision =
      !ai.usedVision && result.extraction && result.extraction.imageCount > 0
        ? ", no vision configured"
        : "";
    console.log(
      `  Model: ${ai.model} (${visionTag}${noVision}) | ${ai.tokensIn} in / ${ai.tokensOut} out | ${(ai.durationMs / 1000).toFixed(1)}s`
    );

    // Decision
    const decision = ai.parsed;
    const childStr = decision.children?.length
      ? JSON.stringify(decision.children)
      : "none";
    console.log(
      `  Decision: send=${decision.send}, children=${childStr}`
    );
  }

  // Expected
  const exp = result.email.expectedOutcome;
  const expChildren = exp.children;
  const expChildStr =
    expChildren === null || expChildren === undefined
      ? null
      : expChildren.length > 0
        ? JSON.stringify(expChildren)
        : "none";
  console.log(
    `  Expected: send=${exp.send}${expChildStr !== null ? `, children=${expChildStr}` : ""}`
  );

  // Status
  if (result.status === "pass") {
    console.log(`  ${GREEN}✓ PASS${RESET}`);
  } else {
    console.log(`  ${RED}✗ FAIL${RESET}`);
    if (result.comparison) {
      printFieldMismatches(result.comparison);
    }
  }
}

function printFieldMismatches(comparison: ComparisonResult): void {
  const { fields } = comparison;
  if (!fields.send.match) {
    console.log(
      `    ${RED}send: expected=${fields.send.expected} actual=${fields.send.actual}${RESET}`
    );
  }
  if (fields.children && !fields.children.match) {
    console.log(
      `    ${RED}children: expected=${JSON.stringify(fields.children.expected)} actual=${JSON.stringify(fields.children.actual)}${RESET}`
    );
  }
  if (fields.attachmentCount && !fields.attachmentCount.match) {
    console.log(
      `    ${RED}attachmentCount: expected=${fields.attachmentCount.expected} actual=${fields.attachmentCount.actual}${RESET}`
    );
  }
  if (fields.imageCount && !fields.imageCount.match) {
    console.log(
      `    ${RED}imageCount: expected=${fields.imageCount.expected} actual=${fields.imageCount.actual}${RESET}`
    );
  }
}

export function printSummary(summary: RunSummary, resultsDir: string): void {
  console.log("");
  console.log("══════════════════════════════════════");
  const passColor = summary.failed === 0 && summary.errors === 0 ? GREEN : RED;
  console.log(
    `${passColor}Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors${RESET}`
  );
  console.log(
    `Tokens: ${summary.totalTokensIn.toLocaleString()} in / ${summary.totalTokensOut.toLocaleString()} out`
  );
  console.log(
    `Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`
  );
  console.log(
    `Report: ${path.join(resultsDir, "report.html")}`
  );
}

// ---- File Artifacts ----

export function writeArtifacts(
  resultsDir: string,
  result: TestResult
): void {
  const slug = `${result.email.id}_${result.email.slug}`;
  const dir = path.join(resultsDir, slug);
  fs.mkdirSync(dir, { recursive: true });

  if (result.prompt) {
    fs.writeFileSync(path.join(dir, "prompt.txt"), result.prompt, "utf-8");
  }
  if (result.aiResult) {
    fs.writeFileSync(
      path.join(dir, "ai_response.json"),
      JSON.stringify(
        {
          raw: result.aiResult.rawResponse,
          parsed: result.aiResult.parsed,
          model: result.aiResult.model,
          usedVision: result.aiResult.usedVision,
          tokensIn: result.aiResult.tokensIn,
          tokensOut: result.aiResult.tokensOut,
          durationMs: result.aiResult.durationMs,
        },
        null,
        2
      ),
      "utf-8"
    );
  }
  if (result.forwardedHtml) {
    fs.writeFileSync(
      path.join(dir, "forwarded.html"),
      result.forwardedHtml,
      "utf-8"
    );
  }
}

export function writeSummaryJson(
  resultsDir: string,
  summary: RunSummary
): void {
  fs.writeFileSync(
    path.join(resultsDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8"
  );
}

// ---- HTML Report ----

export function writeHtmlReport(
  resultsDir: string,
  summary: RunSummary
): void {
  const html = generateHtml(summary);
  fs.writeFileSync(path.join(resultsDir, "report.html"), html, "utf-8");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateHtml(summary: RunSummary): string {
  const passRate =
    summary.totalTests > 0
      ? Math.round((summary.passed / summary.totalTests) * 100)
      : 0;

  const barSegments = summary.results
    .map((r) => {
      const color =
        r.status === "pass"
          ? "#22c55e"
          : r.status === "fail"
            ? "#ef4444"
            : "#eab308";
      return `<div style="flex:1;height:8px;background:${color};"></div>`;
    })
    .join("");

  const testCards = summary.results.map((r, i) => renderTestCard(r, i)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SANE Pipeline — ${esc(summary.fixtureName)}</title>
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
.stat-error { background: #fef9c3; color: #854d0e; }
.stat-neutral { background: #f1f5f9; color: #475569; }
.bar { display: flex; gap: 2px; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
.rate { font-size: 13px; color: #64748b; }

/* Test cards */
.card { background: #fff; border-radius: 10px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); border-left: 4px solid #cbd5e1; overflow: hidden; }
.card.pass { border-left-color: #22c55e; }
.card.fail { border-left-color: #ef4444; }
.card.error { border-left-color: #eab308; }
.card-header { padding: 14px 18px; display: flex; align-items: center; gap: 10px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-pass { background: #dcfce7; color: #166534; }
.badge-fail { background: #fee2e2; color: #991b1b; }
.badge-error { background: #fef9c3; color: #854d0e; }
.card-title { font-size: 15px; font-weight: 600; flex: 1; }
.card-duration { font-size: 12px; color: #94a3b8; }
.card-info { padding: 0 18px 12px; font-size: 13px; color: #64748b; }
.card-info .row { margin-bottom: 4px; }
.card-info .check { color: #22c55e; }
.card-info .cross { color: #ef4444; }

/* Collapsible sections */
details { border-top: 1px solid #f1f5f9; }
details summary { padding: 10px 18px; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; user-select: none; }
details summary:hover { background: #f8fafc; }
details .detail-content { padding: 0 18px 14px; }
pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 500px; overflow-y: auto; }
.email-preview { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.email-preview iframe { width: 100%; height: 500px; border: none; }
</style>
</head>
<body>
<div class="container">

<div class="dashboard">
  <h1>${esc(summary.fixtureName)}</h1>
  <div class="meta">
    ${esc(summary.provider)} / ${esc(summary.model)}${summary.visionModel ? ` + ${esc(summary.visionModel)}` : ""}
    &nbsp;·&nbsp; ${esc(summary.timestamp)}
    &nbsp;·&nbsp; ${(summary.totalDurationMs / 1000).toFixed(1)}s
  </div>
  <div class="stats">
    <span class="stat stat-pass">${summary.passed} passed</span>
    <span class="stat stat-fail">${summary.failed} failed</span>
    <span class="stat stat-error">${summary.errors} errors</span>
    <span class="stat stat-neutral">${summary.totalTokensIn.toLocaleString()} in / ${summary.totalTokensOut.toLocaleString()} out</span>
  </div>
  <div class="bar">${barSegments}</div>
  <div class="rate">${passRate}% pass rate (${summary.passed}/${summary.totalTests})</div>
</div>

${testCards}

</div>
</body>
</html>`;
}

function renderTestCard(result: TestResult, index: number): string {
  const statusClass = result.status;
  const badgeClass = `badge-${result.status}`;
  const badgeLabel =
    result.status === "pass"
      ? "PASS"
      : result.status === "fail"
        ? "FAIL"
        : "ERROR";
  const duration = (result.durationMs / 1000).toFixed(1);

  // Quick info row
  let infoHtml = "";
  if (result.status === "error") {
    infoHtml = `<div class="row">${esc(result.error ?? "Unknown error")}</div>`;
  } else {
    // Expected decision row
    const exp = result.email.expectedOutcome;
    const expChildStr =
      exp.children === null || exp.children === undefined
        ? "—"
        : exp.children.length > 0
          ? exp.children.map((c) => esc(c)).join(", ")
          : "none";
    infoHtml += `<div class="row"><strong>Expected:</strong> send=${exp.send} · children=[${expChildStr}]</div>`;

    // Actual decision row
    if (result.aiResult) {
      const p = result.aiResult.parsed;
      const childStr = p.children?.length
        ? p.children.map((c) => esc(c)).join(", ")
        : "none";
      infoHtml += `<div class="row"><strong>Actual:</strong> send=${p.send} · children=[${childStr}] · ${result.aiResult.model} · ${result.aiResult.tokensIn}/${result.aiResult.tokensOut} tokens</div>`;
    }

    // Comparison row
    if (result.comparison) {
      const f = result.comparison.fields;
      const mark = (ok: boolean) =>
        ok ? '<span class="check">✓</span>' : '<span class="cross">✗</span>';
      let compParts = `${mark(f.send.match)} send`;
      if (f.children) compParts += ` ${mark(f.children.match)} children`;
      if (f.attachmentCount)
        compParts += ` ${mark(f.attachmentCount.match)} attachments`;
      if (f.imageCount) compParts += ` ${mark(f.imageCount.match)} images`;
      infoHtml += `<div class="row">${compParts}</div>`;
    }
  }

  // Collapsible sections
  let sections = "";

  // Source email
  sections += `
<details>
  <summary>Source Email</summary>
  <div class="detail-content">
    <p><strong>From:</strong> ${esc(result.email.from)}</p>
    ${result.email.to ? `<p><strong>To:</strong> ${esc(result.email.to)}</p>` : ""}
    <p><strong>Subject:</strong> ${esc(result.email.subject)}</p>
    <p style="margin-top:8px"><strong>Body:</strong></p>
    <pre>${esc(result.email.body)}</pre>
  </div>
</details>`;

  // Attachments
  if (result.extraction) {
    const ext = result.extraction;
    let attHtml = `<p>${ext.docTexts.length} doc(s), ${ext.images.length} image(s)`;
    if (ext.errors.length > 0) {
      attHtml += `, ${ext.errors.length} error(s)`;
    }
    attHtml += "</p>";

    for (const doc of ext.docTexts) {
      attHtml += `<p style="margin-top:8px"><strong>${esc(doc.filename)}</strong> (${doc.type.toUpperCase()}, ${doc.text.length.toLocaleString()} chars):</p>`;
      attHtml += `<pre>${esc(doc.text)}</pre>`;
    }
    for (const img of ext.images) {
      const kb = (img.sizeBytes / 1024).toFixed(1);
      attHtml += `<p style="margin-top:8px"><strong>${esc(img.filename)}</strong> (${img.mediaType}, ${kb}KB)</p>`;
    }
    for (const err of ext.errors) {
      attHtml += `<p style="color:#ef4444;margin-top:4px">${esc(err)}</p>`;
    }

    sections += `
<details>
  <summary>Attachments (${ext.docTexts.length} doc, ${ext.images.length} images)</summary>
  <div class="detail-content">${attHtml}</div>
</details>`;
  }

  // AI Prompt
  if (result.prompt) {
    sections += `
<details>
  <summary>AI Prompt (${result.prompt.length.toLocaleString()} chars)</summary>
  <div class="detail-content"><pre>${esc(result.prompt)}</pre></div>
</details>`;
  }

  // AI Response
  if (result.aiResult) {
    sections += `
<details>
  <summary>AI Response (raw)</summary>
  <div class="detail-content"><pre>${esc(result.aiResult.rawResponse)}</pre></div>
</details>`;

    // Parsed Decision
    sections += `
<details>
  <summary>Parsed Decision</summary>
  <div class="detail-content"><pre>${esc(JSON.stringify(result.aiResult.parsed, null, 2))}</pre></div>
</details>`;
  }

  // Forwarded email preview
  if (result.forwardedHtml) {
    // Escape for srcdoc attribute
    const srcdocEsc = result.forwardedHtml
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
    sections += `
<details>
  <summary>Forwarded Email Preview</summary>
  <div class="detail-content">
    <div class="email-preview">
      <iframe srcdoc="${srcdocEsc}" sandbox="allow-same-origin"></iframe>
    </div>
  </div>
</details>`;
  }

  return `
<div class="card ${statusClass}">
  <div class="card-header">
    <span class="badge ${badgeClass}">${badgeLabel}</span>
    <span class="card-title">#${esc(result.email.id)} ${esc(result.email.subject)}</span>
    <span class="card-duration">${duration}s</span>
  </div>
  <div class="card-info">${infoHtml}</div>
  ${sections}
</div>`;
}
