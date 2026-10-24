/**
 * One-time backfill script: extract events from existing processed emails.
 *
 * For each processed email with an AI summary, sends a lightweight prompt
 * directly to the configured AI asking to extract dates/events from
 * the summary text. Bypasses the full email analysis pipeline.
 *
 * Usage: npx tsx scripts/backfill-events.ts
 */

import "dotenv/config";
import { prisma } from "@/server/db/prisma";
import OpenAI from "openai";

async function getOpenAIClient(): Promise<{ client: OpenAI; model: string }> {
  const config = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { aiProvider: true, aiModel: true, aiApiKeyEncrypted: true },
  });

  if (!config?.aiApiKeyEncrypted || !config.aiModel) {
    throw new Error("No AI provider configured");
  }

  const { decrypt } = await import("@/lib/encryption");
  const apiKey = decrypt(config.aiApiKeyEncrypted);

  const baseURL =
    config.aiProvider === "grok" ? "https://api.x.ai/v1" : undefined;

  return {
    client: new OpenAI({ apiKey, baseURL }),
    model: config.aiModel,
  };
}

interface ExtractedEvent {
  title: string;
  date: string;
  allDay: boolean;
  childName: string | null;
  location: string | null;
}

async function extractEventsFromSummary(
  client: OpenAI,
  model: string,
  summary: string,
  subject: string,
  childNames: string[],
  emailReceivedAt: Date,
): Promise<ExtractedEvent[]> {
  const emailDate = emailReceivedAt.toISOString().split("T")[0];
  const prompt = `Extract any dates, deadlines, or scheduled events from this school email summary.

Children: ${childNames.join(", ")}
Subject: ${subject}
Email received: ${emailDate}
Summary:
${summary}

Resolve relative dates like "tomorrow", "next week", "this Friday" relative to the email received date (${emailDate}).

For each event found, return:
- "title": short description (e.g. "No School - Mid-winter Break")
- "date": ISO 8601 date (e.g. "2026-03-15" or "2026-03-15T14:00:00"). Use the year from the email received date if not explicitly specified.
- "allDay": true if date-only, false if a specific time is mentioned
- "childName": the specific child's name if the event is for one child, or null if for all
- "location": location if mentioned, else null

Respond with ONLY valid JSON, no markdown: { "events": [ ... ] }
If no events found, respond: { "events": null }`;

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.events)) return [];

    return parsed.events
      .filter(
        (e: Record<string, unknown>) =>
          typeof e.title === "string" &&
          typeof e.date === "string" &&
          !isNaN(new Date(e.date as string).getTime()),
      )
      .map((e: Record<string, unknown>) => ({
        title: e.title as string,
        date: e.date as string,
        allDay: typeof e.allDay === "boolean" ? e.allDay : true,
        childName: typeof e.childName === "string" ? e.childName : null,
        location: typeof e.location === "string" ? e.location : null,
      }));
  } catch {
    console.error("    Failed to parse AI response:", raw.substring(0, 200));
    return [];
  }
}

async function main() {
  const reprocess = process.argv.includes("--reprocess");
  console.log(`Starting event backfill...${reprocess ? " (REPROCESS mode — will delete existing events first)" : ""}\n`);

  const { client, model } = await getOpenAIClient();
  console.log(`Using model: ${model}\n`);

  if (reprocess) {
    const deleted = await prisma.extractedEvent.deleteMany({});
    console.log(`Deleted ${deleted.count} existing event(s)\n`);
  }

  // Get all processed emails that have summaries but no extracted events
  const emails = await prisma.processedEmail.findMany({
    where: {
      aiSummary: { not: null },
      ...(reprocess ? {} : { extractedEvents: { none: {} } }),
    },
    select: {
      id: true,
      userId: true,
      subject: true,
      aiSummary: true,
      aiSubject: true,
      receivedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${emails.length} email(s) to process\n`);

  if (emails.length === 0) {
    console.log("Nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  // Pre-load children per user (decrypt PII)
  const { decryptChildRecord } = await import("../src/lib/pii-encryption");
  const userIds = Array.from(new Set(emails.map((e) => e.userId)));
  const childrenByUser = new Map<string, { name: string; id: string }[]>();
  for (const uid of userIds) {
    const rawChildren = await prisma.child.findMany({
      where: { userId: uid },
    });
    const children = await Promise.all(rawChildren.map((c) => decryptChildRecord(c)));
    childrenByUser.set(uid, children.map((c) => ({ id: c.id, name: c.name })));
  }

  let totalEvents = 0;
  let processed = 0;
  let errors = 0;

  for (const email of emails) {
    const children = childrenByUser.get(email.userId) ?? [];
    const childNames = children.map((c) => c.name);
    const childNameToId = new Map(children.map((c) => [c.name, c.id]));

    try {
      const events = await extractEventsFromSummary(
        client,
        model,
        email.aiSummary!,
        email.aiSubject ?? email.subject,
        childNames,
        email.receivedAt,
      );

      if (events.length > 0) {
        const records = events.map((e) => ({
          userId: email.userId,
          processedEmailId: email.id,
          childId: e.childName
            ? (childNameToId.get(e.childName) ?? null)
            : null,
          title: e.title.slice(0, 300),
          eventDate: new Date(e.date),
          allDay: e.allDay,
          location: e.location?.slice(0, 300) ?? null,
        }));

        await prisma.extractedEvent.createMany({ data: records });
        totalEvents += records.length;
        console.log(
          `  [${processed + 1}/${emails.length}] "${email.subject}" → ${records.length} event(s)`,
        );
        for (const r of records) {
          console.log(
            `    - ${r.title} (${r.eventDate.toISOString().split("T")[0]})`,
          );
        }
      } else {
        console.log(
          `  [${processed + 1}/${emails.length}] "${email.subject}" → no events`,
        );
      }
    } catch (err) {
      errors++;
      console.error(
        `  [${processed + 1}/${emails.length}] ERROR "${email.subject}": ${err instanceof Error ? err.message : err}`,
      );
    }

    processed++;
  }

  console.log(`\nBackfill complete.`);
  console.log(`  Processed: ${processed} email(s)`);
  console.log(`  Events created: ${totalEvents}`);
  console.log(`  Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
