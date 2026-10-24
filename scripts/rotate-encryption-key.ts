/**
 * Re-encrypt every AES-256-GCM column from OLD_ENCRYPTION_KEY to NEW_ENCRYPTION_KEY.
 *
 * Dry run by default: decrypts everything with the old key and reports counts, writes nothing.
 * With --apply: re-encrypts the core tables in a single transaction (all or nothing), then
 * AICallLog (debug logs, can be large) row by row outside it.
 * Values that already decrypt with the new key are skipped, so re-running is safe.
 *
 * Run with:
 *   DATABASE_URL=... OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... \
 *     npx tsx scripts/rotate-encryption-key.ts [--apply]
 *
 * Pause global monitoring first, set ENCRYPTION_KEY to the new key on all services right
 * after --apply succeeds, then run --apply once more to sweep rows written during cutover.
 *
 * This protects data going forward only. Anything readable under the old key before
 * rotation (DB dumps, backups) should be treated as exposed.
 */

import { PrismaClient } from "@prisma/client";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Same format as src/lib/encryption.ts: IV (16) + auth tag (16) + ciphertext
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Every Bytes column written by encrypt(). Keep in sync with prisma/schema.prisma.
const CORE_TARGETS = [
  { model: "emailConnection", fields: ["accessTokenEncrypted", "refreshTokenEncrypted"] },
  {
    model: "child",
    fields: ["nameEncrypted", "gradeEncrypted", "classNameEncrypted", "teachersEncrypted", "additionalInfoEncrypted"],
  },
  { model: "forwardingAddress", fields: ["emailEncrypted", "nameEncrypted"] },
  { model: "systemConfig", fields: ["aiApiKeyEncrypted", "resendApiKeyEncrypted"] },
  { model: "feedbackSnapshot", fields: ["encryptedData"] },
];
const LOG_TARGET = { model: "aICallLog", fields: ["promptEncrypted", "responseEncrypted"] };

function parseKey(name: string): Buffer {
  const hex = process.env[name];
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be 64 hex characters`);
  }
  return Buffer.from(hex, "hex");
}

function encryptWith(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

/** Returns plaintext, or null if the auth tag doesn't verify under this key. */
function tryDecrypt(key: Buffer, data: Buffer): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, IV_LENGTH));
    decipher.setAuthTag(data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
    return Buffer.concat([
      decipher.update(data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function rotateTable(
  db: any,
  { model, fields }: { model: string; fields: string[] },
  keys: { oldKey: Buffer; newKey: Buffer },
  apply: boolean
) {
  const delegate = db[model];
  const select = Object.fromEntries(["id", ...fields].map((f) => [f, true]));
  // ponytail: loads the whole table into memory; batch by id if AICallLog grows past ~100k rows
  const rows: Record<string, unknown>[] = await delegate.findMany({ select });

  let rotated = 0;
  let alreadyNew = 0;
  for (const row of rows) {
    const data: Record<string, Buffer> = {};
    for (const field of fields) {
      if (row[field] == null) continue;
      const blob = Buffer.from(row[field] as Uint8Array);
      const plain = tryDecrypt(keys.oldKey, blob);
      if (plain != null) {
        data[field] = encryptWith(keys.newKey, plain);
      } else if (tryDecrypt(keys.newKey, blob) != null) {
        alreadyNew++;
      } else {
        throw new Error(`${model} ${row.id}.${field} decrypts with neither key; aborting`);
      }
    }
    if (Object.keys(data).length === 0) continue;
    rotated++;
    // updateMany returns a count instead of echoing the full row (blobs included) back
    if (apply) await delegate.updateMany({ where: { id: row.id }, data });
  }
  console.log(`${model.padEnd(18)} rows=${rows.length} rotated=${rotated} fieldsAlreadyNew=${alreadyNew}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const keys = { oldKey: parseKey("OLD_ENCRYPTION_KEY"), newKey: parseKey("NEW_ENCRYPTION_KEY") };
  if (keys.oldKey.equals(keys.newKey)) throw new Error("OLD and NEW keys are identical");

  const host = new URL(process.env.DATABASE_URL ?? "").host;
  console.log(`${apply ? "APPLY" : "DRY RUN"} against ${host}\n`);

  const prisma = new PrismaClient();
  try {
    const rotateCore = async (db: any) => {
      for (const target of CORE_TARGETS) await rotateTable(db, target, keys, apply);
    };
    // Dry run only reads, so it skips the transaction
    if (apply) {
      await prisma.$transaction(rotateCore, { timeout: 5 * 60_000, maxWait: 30_000 });
      console.log("Core tables committed.");
    } else {
      await rotateCore(prisma);
    }
    // Logs outside the transaction: an interrupted pass is fixed by re-running
    await rotateTable(prisma, LOG_TARGET, keys, apply);
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    apply
      ? "\nDone. Set ENCRYPTION_KEY to the new key on web + worker, then re-run --apply to sweep stragglers."
      : "\nDry run OK. Re-run with --apply to write."
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
