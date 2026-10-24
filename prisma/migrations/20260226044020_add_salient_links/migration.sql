-- AlterTable
ALTER TABLE "User" ADD COLUMN "showLinksInSummary" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ProcessedEmail" ADD COLUMN "aiLinks" TEXT;
