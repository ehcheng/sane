/**
 * One-time backfill: inject processedEmailId into sourceEmails JSON entries.
 *
 * For events that have a processedEmailId FK but whose sourceEmails JSON
 * entries lack processedEmailId, this script matches entries and injects
 * the ID so the UI can link back to the Email Log.
 *
 * Dry-run by default. Pass --apply to commit changes.
 *
 * Usage:
 *   npx tsx scripts/backfill-source-email-ids.ts          # dry-run
 *   npx tsx scripts/backfill-source-email-ids.ts --apply   # commit changes
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

  // Fetch all events that have a processedEmailId FK
  const events = await prisma.extractedEvent.findMany({
    where: { processedEmailId: { not: null } },
    select: {
      id: true,
      sourceEmails: true,
      processedEmailId: true,
      processedEmail: {
        select: { id: true, subject: true, fromAddress: true, fromName: true },
      },
    },
  });

  console.log(`Found ${events.length} events with processedEmailId FK`);

  let updated = 0;
  let skipped = 0;
  let noSources = 0;
  let multiMatched = 0;

  for (const event of events) {
    if (!event.sourceEmails || !event.processedEmail) {
      noSources++;
      continue;
    }

    let sources: SourceEntry[];
    try {
      sources = JSON.parse(event.sourceEmails);
    } catch {
      console.warn(`  Event ${event.id}: invalid JSON in sourceEmails, skipping`);
      skipped++;
      continue;
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      noSources++;
      continue;
    }

    // Check if all entries already have processedEmailId
    const allHaveIds = sources.every((s) => !!s.processedEmailId);
    if (allHaveIds) {
      skipped++;
      continue;
    }

    let changed = false;

    if (sources.length === 1 && !sources[0].processedEmailId) {
      // Single-source event: just inject the FK's processedEmailId
      sources[0].processedEmailId = event.processedEmailId!;
      changed = true;
    } else {
      // Multi-source: match by subject + fromAddress
      for (const src of sources) {
        if (src.processedEmailId) continue;
        if (
          src.subject === event.processedEmail.subject &&
          src.fromAddress === event.processedEmail.fromAddress
        ) {
          src.processedEmailId = event.processedEmailId!;
          changed = true;
          multiMatched++;
        }
      }

      // For remaining unmatched entries in multi-source events,
      // try to find matching ProcessedEmails by subject+fromAddress
      const unmatched = sources.filter((s) => !s.processedEmailId);
      if (unmatched.length > 0) {
        // Batch lookup: find ProcessedEmails that match any unmatched entry
        const candidates = await prisma.processedEmail.findMany({
          where: {
            userId: (await prisma.extractedEvent.findUnique({
              where: { id: event.id },
              select: { userId: true },
            }))!.userId,
            OR: unmatched.map((s) => ({
              subject: s.subject,
              fromAddress: s.fromAddress,
            })),
          },
          select: { id: true, subject: true, fromAddress: true },
        });

        for (const src of unmatched) {
          const match = candidates.find(
            (c) => c.subject === src.subject && c.fromAddress === src.fromAddress
          );
          if (match) {
            src.processedEmailId = match.id;
            changed = true;
            multiMatched++;
          }
        }
      }
    }

    if (!changed) {
      skipped++;
      continue;
    }

    const newJson = JSON.stringify(sources);
    if (apply) {
      await prisma.extractedEvent.update({
        where: { id: event.id },
        data: { sourceEmails: newJson },
      });
    }
    updated++;
    console.log(`  ${apply ? "Updated" : "Would update"} event ${event.id} (${sources.length} source(s))`);
  }

  console.log(`\nSummary:`);
  console.log(`  Events processed: ${events.length}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (already have IDs): ${skipped}`);
  console.log(`  No sources: ${noSources}`);
  console.log(`  Multi-source matches: ${multiMatched}`);

  if (!apply && updated > 0) {
    console.log(`\nRe-run with --apply to commit these changes.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
