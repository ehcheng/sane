// @ts-nocheck — This migration script was for the Phase 1→2 transition.
// Old plaintext columns have been dropped; this script is kept for reference only.

/**
 * Data migration: encrypt existing plaintext PII in Child and ForwardingAddress.
 *
 * Idempotent — skips records where encrypted columns are already populated.
 * Run with: npx tsx scripts/migrate-encrypt-pii.ts
 */

import { PrismaClient } from "@prisma/client";
import { encrypt } from "../src/lib/encryption";
import { createHash } from "crypto";

const prisma = new PrismaClient();

function hashEmail(email: string): string {
  return createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex");
}

async function migrateChildren() {
  const children = await prisma.child.findMany({
    where: { nameEncrypted: null },
  });

  console.log(`Found ${children.length} Child record(s) to encrypt`);

  for (const child of children) {
    if (!child.name || !child.grade) {
      console.warn(`  Skipping child ${child.id} — missing name or grade`);
      continue;
    }

    await prisma.child.update({
      where: { id: child.id },
      data: {
        nameEncrypted: encrypt(child.name),
        gradeEncrypted: encrypt(child.grade),
        classNameEncrypted: child.className ? encrypt(child.className) : null,
        teachersEncrypted: encrypt(JSON.stringify(child.teachers)),
        additionalInfoEncrypted: child.additionalInfo
          ? encrypt(child.additionalInfo)
          : null,
      },
    });
    console.log(`  Encrypted child ${child.id} (${child.name})`);
  }
}

async function migrateForwardingAddresses() {
  const addresses = await prisma.forwardingAddress.findMany({
    where: { emailEncrypted: null },
  });

  console.log(`Found ${addresses.length} ForwardingAddress record(s) to encrypt`);

  for (const addr of addresses) {
    if (!addr.email) {
      console.warn(`  Skipping address ${addr.id} — missing email`);
      continue;
    }

    await prisma.forwardingAddress.update({
      where: { id: addr.id },
      data: {
        emailEncrypted: encrypt(addr.email),
        emailHash: hashEmail(addr.email),
        nameEncrypted: addr.name ? encrypt(addr.name) : null,
      },
    });
    console.log(`  Encrypted address ${addr.id} (${addr.email})`);
  }
}

async function main() {
  console.log("=== PII Encryption Migration ===\n");

  await migrateChildren();
  console.log();
  await migrateForwardingAddresses();

  console.log("\n=== Migration complete ===");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
