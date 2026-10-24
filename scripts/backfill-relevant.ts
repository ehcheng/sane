/**
 * Backfill aiRelevant for all existing ProcessedEmail records.
 *
 * Uses stored subject + AI summary + AI reasoning to evaluate relevance
 * against the user's children — no Gmail re-fetch needed, no forwarding.
 *
 * Usage: npx tsx scripts/backfill-relevant.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (dryRun) console.log("=== DRY RUN — no DB updates ===\n");

  // Load AI provider dynamically (uses DB config + env)
  const { getAIProvider } = await import("../src/server/ai/provider");
  const provider = await getAIProvider();
  console.log(`AI provider: ${provider.providerName}`);

  // Get all users with children (decrypt PII)
  const { decryptChildRecord } = await import("../src/lib/pii-encryption");
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalAlreadyIrrelevant = 0;

  for (const user of users) {
    const rawChildren = await prisma.child.findMany({ where: { userId: user.id } });
    const children = await Promise.all(rawChildren.map((c) => decryptChildRecord(c)));

    if (children.length === 0) {
      console.log(`\nSkipping ${user.name} — no children configured`);
      continue;
    }

    const childrenDesc = children
      .map((c) => `${c.name} (${c.grade})`)
      .join(", ");
    console.log(`\n=== ${user.name} (${user.email}) ===`);
    console.log(`Children: ${childrenDesc}`);

    // Get all AI-analyzed emails (skip rule-based ones — they keep default true)
    const emails = await prisma.processedEmail.findMany({
      where: {
        userId: user.id,
        aiProvider: { not: "rule" },
      },
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        aiDecision: true,
        aiRelevant: true,
        aiSummary: true,
        aiReasoning: true,
      },
      orderBy: { receivedAt: "asc" },
    });

    console.log(`${emails.length} AI-analyzed emails to evaluate`);

    // Actionable emails are always relevant — skip them
    const toEvaluate = emails.filter((e) => !e.aiDecision);
    const actionable = emails.length - toEvaluate.length;
    console.log(`${actionable} actionable (always relevant), ${toEvaluate.length} to evaluate`);

    // Batch emails into groups for efficiency (one AI call per batch)
    const BATCH_SIZE = 10;
    for (let i = 0; i < toEvaluate.length; i += BATCH_SIZE) {
      const batch = toEvaluate.slice(i, i + BATCH_SIZE);

      const emailDescriptions = batch
        .map((e, idx) => {
          const lines = [`[${idx + 1}] From: ${e.fromAddress}`, `Subject: ${e.subject}`];
          if (e.aiSummary) lines.push(`Summary: ${e.aiSummary}`);
          if (e.aiReasoning) lines.push(`AI Reasoning: ${e.aiReasoning}`);
          return lines.join("\n");
        })
        .join("\n\n");

      const prompt = [
        "You are evaluating whether school emails are RELEVANT to a specific family.",
        "",
        `CHILDREN: ${childrenDesc}`,
        "",
        "DEFINITION OF RELEVANT: The email pertains to any of the listed children, their grade level, or the whole school — including FYI messages, newsletters, and general announcements.",
        "DEFINITION OF IRRELEVANT: The email targets a different grade, is commercial spam, or is completely unrelated to the family.",
        "",
        `EMAILS (${batch.length}):`,
        emailDescriptions,
        "",
        `Respond with a JSON array of ${batch.length} booleans, one per email, in order. true = relevant, false = irrelevant.`,
        "Example for 3 emails: [true, false, true]",
        "Respond with ONLY the JSON array, no other text.",
      ].join("\n");

      const result = await provider.generateText(prompt);

      // Parse the boolean array
      let relevance: boolean[];
      try {
        const match = result.text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error("No array found");
        relevance = JSON.parse(match[0]);
        if (!Array.isArray(relevance) || relevance.length !== batch.length) {
          throw new Error(`Expected ${batch.length} values, got ${relevance.length}`);
        }
      } catch (err) {
        console.error(`  Batch ${i / BATCH_SIZE + 1}: Failed to parse AI response: ${result.text.slice(0, 200)}`);
        totalSkipped += batch.length;
        continue;
      }

      // Update records
      for (let j = 0; j < batch.length; j++) {
        const email = batch[j];
        const isRelevant = relevance[j];

        if (!isRelevant) {
          console.log(`  IRRELEVANT: "${email.subject.slice(0, 60)}" from ${email.fromAddress}`);
          if (!dryRun) {
            await prisma.processedEmail.update({
              where: { id: email.id },
              data: { aiRelevant: false },
            });
          }
          totalAlreadyIrrelevant++;
        } else {
          // Already defaults to true, but set explicitly for clarity
          if (!dryRun && !email.aiRelevant) {
            await prisma.processedEmail.update({
              where: { id: email.id },
              data: { aiRelevant: true },
            });
          }
          totalUpdated++;
        }
      }

      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(toEvaluate.length / BATCH_SIZE);
      const irrelevantInBatch = relevance.filter((r) => !r).length;
      console.log(`  Batch ${batchNum}/${totalBatches}: ${irrelevantInBatch}/${batch.length} irrelevant (${result.latencyMs}ms)`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Relevant (no change): ${totalUpdated}`);
  console.log(`Marked irrelevant: ${totalAlreadyIrrelevant}`);
  console.log(`Skipped (parse errors): ${totalSkipped}`);
  if (dryRun) console.log("\nDry run — no changes written.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
