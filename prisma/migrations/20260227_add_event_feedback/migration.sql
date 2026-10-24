-- AlterTable
ALTER TABLE "ExtractedEvent" ADD COLUMN "userFeedback" TEXT,
ADD COLUMN "userFeedbackReason" TEXT,
ADD COLUMN "userFeedbackAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FeedbackSnapshot" ALTER COLUMN "processedEmailId" DROP NOT NULL,
ADD COLUMN "extractedEventId" TEXT;
