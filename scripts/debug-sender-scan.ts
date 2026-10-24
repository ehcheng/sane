/**
 * Debug script: check what Gmail API returns for a specific user's inbox
 * and whether a specific domain appears.
 *
 * Usage: npx tsx scripts/debug-sender-scan.ts
 */
import "dotenv/config";
import { prisma } from "../src/server/db/prisma";
import { getValidAccessToken } from "../src/server/gmail/token-manager";
import { getGmailClient, parseFromHeader } from "../src/server/gmail/client";

const TARGET_EMAIL = "you@example.com";
const SEARCH_DOMAIN = "school.example.org";

async function main() {
  // Find the user
  const user = await prisma.user.findFirst({
    where: { email: { equals: TARGET_EMAIL, mode: "insensitive" } },
    select: { id: true, email: true, emailAccountType: true, emailFilterMode: true },
  });
  if (!user) {
    console.log(`No user found with email ${TARGET_EMAIL}`);
    return;
  }
  console.log("User:", user);

  // Get Gmail connection
  const connection = await prisma.emailConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true, emailAddress: true },
  });
  if (!connection) {
    console.log("No Gmail connection found");
    return;
  }
  console.log("Connection:", connection);

  const accessToken = await getValidAccessToken(connection.id);
  const gmail = getGmailClient(accessToken);

  // 1. Search specifically for messages from the target domain
  console.log(`\n--- Searching for messages from *@${SEARCH_DOMAIN} ---`);
  const targetSearch = await gmail.users.messages.list({
    userId: "me",
    q: `from:${SEARCH_DOMAIN}`,
    maxResults: 10,
  });
  console.log(`Found ${targetSearch.data.resultSizeEstimate ?? 0} messages from ${SEARCH_DOMAIN}`);

  if (targetSearch.data.messages?.length) {
    for (const msg of targetSearch.data.messages.slice(0, 3)) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });
      const headers = detail.data.payload?.headers ?? [];
      const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value;
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value;
      const date = headers.find((h) => h.name?.toLowerCase() === "date")?.value;
      const labels = detail.data.labelIds ?? [];
      console.log(`  Message: ${msg.id}`);
      console.log(`    From: ${from}`);
      console.log(`    Subject: ${subject}`);
      console.log(`    Date: ${date}`);
      console.log(`    Labels: ${labels.join(", ")}`);

      if (from) {
        const parsed = parseFromHeader(from);
        const domain = parsed.email.split("@")[1]?.toLowerCase();
        console.log(`    Parsed domain: ${domain}`);
      }
    }
  }

  // 2. Check if these messages have INBOX label
  console.log(`\n--- Checking if ${SEARCH_DOMAIN} messages are in:inbox ---`);
  const inboxSearch = await gmail.users.messages.list({
    userId: "me",
    q: `from:${SEARCH_DOMAIN} in:inbox`,
    maxResults: 10,
  });
  console.log(`Found ${inboxSearch.data.resultSizeEstimate ?? 0} messages from ${SEARCH_DOMAIN} in:inbox`);

  // 3. Try without in:inbox restriction
  console.log(`\n--- Checking without label restriction ---`);
  const anySearch = await gmail.users.messages.list({
    userId: "me",
    q: `from:${SEARCH_DOMAIN} newer_than:30d`,
    maxResults: 10,
  });
  console.log(`Found ${anySearch.data.resultSizeEstimate ?? 0} messages from ${SEARCH_DOMAIN} in last 30 days (any label)`);

  // 4. Now replicate what fetchRecentSenders does
  console.log(`\n--- Replicating fetchRecentSenders query ---`);
  const after = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox after:${after}`,
    maxResults: 500,
  });
  const totalInbox = listRes.data.resultSizeEstimate ?? 0;
  const returnedIds = listRes.data.messages?.length ?? 0;
  console.log(`in:inbox after:${after} → estimate=${totalInbox}, returned=${returnedIds}`);

  // Check how many of those 500 messages are from the target domain
  if (listRes.data.messages?.length) {
    let foundCount = 0;
    const domainSet = new Map<string, number>();

    // Sample first 100 to show domain distribution
    const sampleIds = listRes.data.messages.slice(0, 100);
    for (const msg of sampleIds) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From"],
      });
      const from = detail.data.payload?.headers?.find(
        (h) => h.name?.toLowerCase() === "from"
      )?.value;
      if (from) {
        const parsed = parseFromHeader(from);
        const domain = parsed.email.split("@")[1]?.toLowerCase();
        if (domain) {
          domainSet.set(domain, (domainSet.get(domain) ?? 0) + 1);
          if (domain === SEARCH_DOMAIN) foundCount++;
        }
      }
    }

    console.log(`\nDomain distribution (first 100 messages):`);
    const sorted = Array.from(domainSet.entries()).sort((a, b) => b[1] - a[1]);
    for (const [domain, count] of sorted.slice(0, 30)) {
      console.log(`  ${domain}: ${count}`);
    }
    console.log(`\n${SEARCH_DOMAIN} found in first 100: ${foundCount} times`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
