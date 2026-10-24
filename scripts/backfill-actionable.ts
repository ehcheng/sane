// @ts-nocheck
/**
 * One-time backfill: set `actionable = true` on existing ExtractedEvents
 * whose source email(s) had aiDecision = true (i.e., AI decided to forward).
 *
 * Two passes:
 *   1. Direct FK — event.processedEmail.aiDecision = true
 *   2. Merged sources — parse sourceEmails JSON, check if any processedEmailId
 *      links to a ProcessedEmail with aiDecision = true
 *
 * Dry-run by default. Pass --apply to commit changes.
 *
 * Usage:
 *   npx tsx scripts/backfill-actionable.ts          # dry-run
 *   npx tsx scripts/backfill-actionable.ts --apply   # commit changes
 */

import "dotenv/config";
import { prisma } from "@/server/db/prisma";

interface SourceEntry {
  processedEmailId?: string;
  subject: string;
  fromName: string | null;
  fromAddress: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "MODE: APPLY (will write to DB)" : "MODE: DRY-RUN (pass --apply to commit)");

  // -----------------------------------------------------------------------
  // Pass 1: Direct FK — processedEmail.aiDecision = true
  // -----------------------------------------------------------------------
  console.log("\n--- Pass 1: Direct FK (processedEmail.aiDecision = true) ---");

  const directCount = await prisma.extractedEvent.count({
    where: {
      actionable: false,
      processedEmail: { aiDecision: true },
    },
  });

  console.log(`  Found ${directCount} events to mark actionable via direct FK`);

  if (apply && directCount > 0) {
    const result = await prisma.extractedEvent.updateMany({
      where: {
        actionable: false,
        processedEmail: { aiDecision: true },
      },
      data: { actionable: true },
    });
    console.log(`  Updated ${result.count} events`);
  }

  // -----------------------------------------------------------------------
  // Pass 2: Merged sources — sourceEmails JSON contains additional emails
  // -----------------------------------------------------------------------
  console.log("\n--- Pass 2: Merged source emails ---");

  // Fetch events that are still not actionable and have sourceEmails JSON
  const remaining = await prisma.extractedEvent.findMany({
    where: {
      actionable: false,
      sourceEmails: { not: null },
    },
    select: {
      id: true,
      sourceEmails: true,
    },
  });

  console.log(`  Checking ${remaining.length} non-actionable events with sourceEmails`);

  // Collect all processedEmailIds from sourceEmails JSON across all events
  const eventSourceMap = new Map<string, string[]>(); // eventId → processedEmailIds
  for (const event of remaining) {
    if (!event.sourceEmails) continue;
    let sources: SourceEntry[];
    try {
      sources = JSON.parse(event.sourceEmails);
    } catch {
      continue;
    }
    if (!Array.isArray(sources)) continue;

    const ids = sources
      .map((s) => s.processedEmailId)
      .filter((id): id is string => !!id);

    if (ids.length > 0) {
      eventSourceMap.set(event.id, ids);
    }
  }

  // Batch-fetch which of those processedEmailIds have aiDecision = true
  const allSourceIds = [...new Set([...eventSourceMap.values()].flat())];
  console.log(`  Found ${allSourceIds.length} unique source email IDs to check`);

  const actionableEmails = allSourceIds.length > 0
    ? await prisma.processedEmail.findMany({
        where: {
          id: { in: allSourceIds },
          aiDecision: true,
        },
        select: { id: true },
      })
    : [];

  const actionableIds = new Set(actionableEmails.map((e) => e.id));
  console.log(`  ${actionableIds.size} of those have aiDecision = true`);

  // Find events where any source is actionable
  const mergeUpdates: string[] = [];
  for (const [eventId, sourceIds] of eventSourceMap) {
    if (sourceIds.some((id) => actionableIds.has(id))) {
      mergeUpdates.push(eventId);
    }
  }

  console.log(`  ${mergeUpdates.length} events to mark actionable via merged sources`);

  if (apply && mergeUpdates.length > 0) {
    const result = await prisma.extractedEvent.updateMany({
      where: { id: { in: mergeUpdates } },
      data: { actionable: true },
    });
    console.log(`  Updated ${result.count} events`);
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const totalUpdated = directCount + mergeUpdates.length;
  console.log("\n--- Summary ---");
  console.log(`  Pass 1 (direct FK):      ${directCount}`);
  console.log(`  Pass 2 (merged sources): ${mergeUpdates.length}`);
  console.log(`  Total:                   ${totalUpdated}`);

  if (!apply && totalUpdated > 0) {
    console.log("\nRe-run with --apply to commit these changes.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
