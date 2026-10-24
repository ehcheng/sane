-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'OUTLOOK');

-- RenameTable
ALTER TABLE "GmailConnection" RENAME TO "EmailConnection";

-- AddColumn: provider (with default for existing rows)
ALTER TABLE "EmailConnection" ADD COLUMN "provider" "EmailProvider" NOT NULL DEFAULT 'GMAIL';

-- RenameColumn: gmailAddress -> emailAddress
ALTER TABLE "EmailConnection" RENAME COLUMN "gmailAddress" TO "emailAddress";

-- RenameColumn: gmailHistoryId -> syncCursor
ALTER TABLE "EmailConnection" RENAME COLUMN "gmailHistoryId" TO "syncCursor";

-- RenameColumn on ProcessedEmail: gmailMessageId -> externalMessageId
ALTER TABLE "ProcessedEmail" RENAME COLUMN "gmailMessageId" TO "externalMessageId";

-- RenameColumn on User: gmailAccountType -> emailAccountType
ALTER TABLE "User" RENAME COLUMN "gmailAccountType" TO "emailAccountType";

-- Rename indexes/constraints that reference the old table name
ALTER INDEX "GmailConnection_pkey" RENAME TO "EmailConnection_pkey";
ALTER INDEX "GmailConnection_userId_key" RENAME TO "EmailConnection_userId_key";

-- Rename unique constraint on ProcessedEmail
ALTER INDEX "ProcessedEmail_userId_gmailMessageId_key" RENAME TO "ProcessedEmail_userId_externalMessageId_key";
