/**
 * Centralized PII encrypt/decrypt helpers for Child and ForwardingAddress models.
 *
 * Uses dynamic import of @/lib/encryption to avoid `crypto` in the Next.js
 * server bundle (see MEMORY.md gotchas re: top-level Node.js built-in imports).
 */

import type { Teacher } from "@/lib/validators";

// Lazy-loaded encryption module (avoids top-level crypto import)
let _encrypt: ((plaintext: string) => Buffer) | null = null;
let _decrypt: ((data: Buffer) => string) | null = null;

async function getEncryption() {
  if (!_encrypt || !_decrypt) {
    const mod = await import("@/lib/encryption");
    _encrypt = mod.encrypt;
    _decrypt = mod.decrypt;
  }
  return { encrypt: _encrypt, decrypt: _decrypt };
}

// ---------------------------------------------------------------------------
// Email hashing (deterministic, for unique constraints / lookups)
// ---------------------------------------------------------------------------

export async function hashEmail(email: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256")
    .update(email.toLowerCase().trim())
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Child model
// ---------------------------------------------------------------------------

/** Plaintext child fields as received from the tRPC input / validator */
export interface ChildPlaintext {
  name: string;
  grade: string;
  className?: string | null;
  teachers: Teacher[];
  additionalInfo?: string | null;
  pronouns?: string | null;
}

/** Encrypted child fields for Prisma create/update data */
export interface ChildEncrypted {
  nameEncrypted: Buffer;
  gradeEncrypted: Buffer;
  classNameEncrypted: Buffer | null;
  teachersEncrypted: Buffer;
  additionalInfoEncrypted: Buffer | null;
}

/** Normalize legacy string[] teachers to structured Teacher[] */
function normalizeTeachers(raw: unknown[]): Teacher[] {
  return raw.map((entry) =>
    typeof entry === "string" ? { name: entry } : (entry as Teacher)
  );
}

export async function encryptChildFields(
  plain: ChildPlaintext
): Promise<ChildEncrypted> {
  const { encrypt } = await getEncryption();
  return {
    nameEncrypted: encrypt(plain.name),
    gradeEncrypted: encrypt(plain.grade),
    classNameEncrypted: plain.className ? encrypt(plain.className) : null,
    teachersEncrypted: encrypt(JSON.stringify(plain.teachers)),
    additionalInfoEncrypted: plain.additionalInfo
      ? encrypt(plain.additionalInfo)
      : null,
  };
}

/** Decrypt a Prisma Child record that has encrypted columns. */
export async function decryptChildRecord<
  T extends {
    nameEncrypted: Buffer;
    gradeEncrypted: Buffer;
    classNameEncrypted: Buffer | null;
    teachersEncrypted: Buffer;
    additionalInfoEncrypted: Buffer | null;
  },
>(
  record: T
): Promise<
  Omit<
    T,
    | "nameEncrypted"
    | "gradeEncrypted"
    | "classNameEncrypted"
    | "teachersEncrypted"
    | "additionalInfoEncrypted"
  > & ChildPlaintext
> {
  const { decrypt } = await getEncryption();
  const {
    nameEncrypted,
    gradeEncrypted,
    classNameEncrypted,
    teachersEncrypted,
    additionalInfoEncrypted,
    ...rest
  } = record;
  return {
    ...rest,
    name: decrypt(nameEncrypted),
    grade: decrypt(gradeEncrypted),
    className: classNameEncrypted ? decrypt(classNameEncrypted) : null,
    teachers: normalizeTeachers(JSON.parse(decrypt(teachersEncrypted))),
    additionalInfo: additionalInfoEncrypted
      ? decrypt(additionalInfoEncrypted)
      : null,
  } as Omit<
    T,
    | "nameEncrypted"
    | "gradeEncrypted"
    | "classNameEncrypted"
    | "teachersEncrypted"
    | "additionalInfoEncrypted"
  > &
    ChildPlaintext;
}

// ---------------------------------------------------------------------------
// ForwardingAddress model
// ---------------------------------------------------------------------------

export interface ForwardingPlaintext {
  email: string;
  name?: string | null;
}

export interface ForwardingEncrypted {
  emailEncrypted: Buffer;
  emailHash: string;
  nameEncrypted: Buffer | null;
}

export async function encryptForwardingFields(
  plain: ForwardingPlaintext
): Promise<ForwardingEncrypted> {
  const { encrypt } = await getEncryption();
  return {
    emailEncrypted: encrypt(plain.email),
    emailHash: await hashEmail(plain.email),
    nameEncrypted: plain.name ? encrypt(plain.name) : null,
  };
}

/** Decrypt a Prisma ForwardingAddress record that has encrypted columns. */
export async function decryptForwardingRecord<
  T extends {
    emailEncrypted: Buffer;
    nameEncrypted: Buffer | null;
  },
>(
  record: T
): Promise<
  Omit<T, "emailEncrypted" | "nameEncrypted"> & { email: string; name: string | null }
> {
  const { decrypt } = await getEncryption();
  const { emailEncrypted, nameEncrypted, ...rest } = record;
  return {
    ...rest,
    email: decrypt(emailEncrypted),
    name: nameEncrypted ? decrypt(nameEncrypted) : null,
  } as Omit<T, "emailEncrypted" | "nameEncrypted"> & {
    email: string;
    name: string | null;
  };
}
