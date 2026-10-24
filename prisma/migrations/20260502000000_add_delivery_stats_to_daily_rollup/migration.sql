-- AlterTable
ALTER TABLE "ProcessedEmailDailyStats" ADD COLUMN "deliveredCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProcessedEmailDailyStats" ADD COLUMN "bouncedCount" INTEGER NOT NULL DEFAULT 0;
