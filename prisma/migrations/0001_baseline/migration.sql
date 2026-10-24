-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SummaryStyle" AS ENUM ('CONCISE', 'STANDARD', 'DETAILED');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'FEATURE_REQUEST', 'USABILITY', 'EMAIL_QUALITY', 'GENERAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pendingEmail" TEXT,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "emailVerified" TIMESTAMP(3),
    "wizardStep" INTEGER NOT NULL DEFAULT 0,
    "isMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "summaryStyle" "SummaryStyle" NOT NULL DEFAULT 'CONCISE',
    "forwardingMode" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "feedbackTrainingConsent" TEXT DEFAULT 'granted',
    "digestDayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "digestTimeHour" INTEGER NOT NULL DEFAULT 8,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "lastDigestSentAt" TIMESTAMP(3),
    "individualForwardingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyBriefEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklyBriefEnabled" BOOLEAN NOT NULL DEFAULT false,
    "briefScope" TEXT NOT NULL DEFAULT 'ALL',
    "dailyBriefHour" INTEGER NOT NULL DEFAULT 6,
    "weeklyBriefDay" INTEGER NOT NULL DEFAULT 0,
    "weeklyBriefHour" INTEGER NOT NULL DEFAULT 9,
    "lastDailyBriefSentAt" TIMESTAMP(3),
    "lastWeeklyBriefSentAt" TIMESTAMP(3),
    "calendarToken" TEXT,
    "defaultEventsView" TEXT NOT NULL DEFAULT 'agenda',
    "completedTours" TEXT NOT NULL DEFAULT '[]',
    "gmailAccountType" TEXT NOT NULL DEFAULT 'DEDICATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailFilterMode" TEXT NOT NULL DEFAULT 'ALL',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailAddress" TEXT NOT NULL,
    "accessTokenEncrypted" BYTEA NOT NULL,
    "refreshTokenEncrypted" BYTEA NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "gmailHistoryId" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reauthNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "relationship" VARCHAR(50),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Parent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nameEncrypted" BYTEA NOT NULL,
    "gradeEncrypted" BYTEA NOT NULL,
    "classNameEncrypted" BYTEA,
    "teachersEncrypted" BYTEA NOT NULL,
    "additionalInfoEncrypted" BYTEA,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgnoredActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(75) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderEmail" VARCHAR(320) NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SenderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedSender" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pattern" VARCHAR(320) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForwardingAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEncrypted" BYTEA NOT NULL,
    "emailHash" TEXT NOT NULL,
    "nameEncrypted" BYTEA,
    "label" VARCHAR(30),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForwardingAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "recentActivityLimit" INTEGER NOT NULL DEFAULT 50,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiApiKeyEncrypted" BYTEA,
    "aiVisionModel" TEXT,
    "tokenCostInputPerMillion" DOUBLE PRECISION,
    "tokenCostOutputPerMillion" DOUBLE PRECISION,
    "aiSystemInstruction" TEXT,
    "aiRelevanceInstruction" TEXT,
    "aiSummaryInstructionConcise" TEXT,
    "aiSummaryInstructionStandard" TEXT,
    "aiSummaryInstructionDetailed" TEXT,
    "aiResponseFormatInstruction" TEXT,
    "aiNoSendInstruction" TEXT,
    "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "activeHoursStart" INTEGER NOT NULL DEFAULT 6,
    "activeHoursEnd" INTEGER NOT NULL DEFAULT 22,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "brandName" TEXT NOT NULL DEFAULT 'SANE',
    "brandTagline" TEXT NOT NULL DEFAULT 'School Alerts, Notices & Essentials',
    "appUrl" TEXT,
    "resendApiKeyEncrypted" BYTEA,
    "resendFromAddress" TEXT,
    "resendWebhookSecret" TEXT,
    "emailFooterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailFooterText" TEXT,
    "debugMode" BOOLEAN NOT NULL DEFAULT false,
    "showDebugUI" BOOLEAN NOT NULL DEFAULT false,
    "logDir" TEXT NOT NULL DEFAULT 'logs',
    "signupCodeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "signupCode" TEXT,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "eventRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "aiEventExtractionInstruction" TEXT,
    "aiBriefSummaryInstruction" TEXT,
    "dailyBriefEventDays" INTEGER NOT NULL DEFAULT 3,
    "alertCooldownMinutes" INTEGER NOT NULL DEFAULT 30,
    "broadcastMessage" TEXT,
    "broadcastActive" BOOLEAN NOT NULL DEFAULT false,
    "broadcastEndsAt" TIMESTAMP(3),

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "aiDecision" BOOLEAN NOT NULL,
    "aiRelevant" BOOLEAN NOT NULL DEFAULT true,
    "aiSummary" TEXT,
    "aiSubject" TEXT,
    "aiProvider" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL,
    "aiTokensInput" INTEGER NOT NULL,
    "aiTokensOutput" INTEGER NOT NULL,
    "aiLatencyMs" INTEGER NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "forwarded" BOOLEAN NOT NULL DEFAULT false,
    "isManualForward" BOOLEAN NOT NULL DEFAULT false,
    "isBackfill" BOOLEAN NOT NULL DEFAULT false,
    "isDuplicateSlug" BOOLEAN NOT NULL DEFAULT false,
    "forwardedAt" TIMESTAMP(3),
    "resendMessageId" TEXT,
    "deliveryStatus" TEXT DEFAULT 'pending',
    "deliveryError" TEXT,
    "deliveryUpdatedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "userFeedback" TEXT,
    "userFeedbackReason" TEXT,
    "userFeedbackAt" TIMESTAMP(3),
    "aiReasoning" TEXT,
    "topicSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEmailDailyStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "forwardedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEmailDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processedEmailId" TEXT,
    "title" VARCHAR(300) NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "location" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processedEmailId" TEXT NOT NULL,
    "feedbackValue" TEXT NOT NULL,
    "encryptedData" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "page" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ChildToExtractedEvent" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_userId_key" ON "GmailConnection"("userId");

-- CreateIndex
CREATE INDEX "Parent_userId_idx" ON "Parent"("userId");

-- CreateIndex
CREATE INDEX "Child_userId_idx" ON "Child"("userId");

-- CreateIndex
CREATE INDEX "IgnoredActivity_userId_idx" ON "IgnoredActivity"("userId");

-- CreateIndex
CREATE INDEX "SenderRule_userId_idx" ON "SenderRule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SenderRule_userId_senderEmail_key" ON "SenderRule"("userId", "senderEmail");

-- CreateIndex
CREATE INDEX "AllowedSender_userId_idx" ON "AllowedSender"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedSender_userId_pattern_key" ON "AllowedSender"("userId", "pattern");

-- CreateIndex
CREATE INDEX "ForwardingAddress_userId_idx" ON "ForwardingAddress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ForwardingAddress_userId_emailHash_key" ON "ForwardingAddress"("userId", "emailHash");

-- CreateIndex
CREATE INDEX "ProcessedEmail_userId_createdAt_idx" ON "ProcessedEmail"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessedEmail_createdAt_idx" ON "ProcessedEmail"("createdAt");

-- CreateIndex
CREATE INDEX "ProcessedEmail_userId_topicSlug_createdAt_idx" ON "ProcessedEmail"("userId", "topicSlug", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEmail_userId_gmailMessageId_key" ON "ProcessedEmail"("userId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "ProcessedEmailDailyStats_date_idx" ON "ProcessedEmailDailyStats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEmailDailyStats_userId_date_key" ON "ProcessedEmailDailyStats"("userId", "date");

-- CreateIndex
CREATE INDEX "ExtractedEvent_userId_eventDate_idx" ON "ExtractedEvent"("userId", "eventDate");

-- CreateIndex
CREATE INDEX "ExtractedEvent_processedEmailId_idx" ON "ExtractedEvent"("processedEmailId");

-- CreateIndex
CREATE INDEX "AdminAlert_type_resolvedAt_idx" ON "AdminAlert"("type", "resolvedAt");

-- CreateIndex
CREATE INDEX "AdminAlert_createdAt_idx" ON "AdminAlert"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAlert_dedupKey_resolvedAt_key" ON "AdminAlert"("dedupKey", "resolvedAt");

-- CreateIndex
CREATE INDEX "FeedbackSnapshot_userId_idx" ON "FeedbackSnapshot"("userId");

-- CreateIndex
CREATE INDEX "UserFeedback_userId_idx" ON "UserFeedback"("userId");

-- CreateIndex
CREATE INDEX "UserFeedback_createdAt_idx" ON "UserFeedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "_ChildToExtractedEvent_AB_unique" ON "_ChildToExtractedEvent"("A", "B");

-- CreateIndex
CREATE INDEX "_ChildToExtractedEvent_B_index" ON "_ChildToExtractedEvent"("B");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parent" ADD CONSTRAINT "Parent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredActivity" ADD CONSTRAINT "IgnoredActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderRule" ADD CONSTRAINT "SenderRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowedSender" ADD CONSTRAINT "AllowedSender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwardingAddress" ADD CONSTRAINT "ForwardingAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedEmail" ADD CONSTRAINT "ProcessedEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedEvent" ADD CONSTRAINT "ExtractedEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedEvent" ADD CONSTRAINT "ExtractedEvent_processedEmailId_fkey" FOREIGN KEY ("processedEmailId") REFERENCES "ProcessedEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSnapshot" ADD CONSTRAINT "FeedbackSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFeedback" ADD CONSTRAINT "UserFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChildToExtractedEvent" ADD CONSTRAINT "_ChildToExtractedEvent_A_fkey" FOREIGN KEY ("A") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChildToExtractedEvent" ADD CONSTRAINT "_ChildToExtractedEvent_B_fkey" FOREIGN KEY ("B") REFERENCES "ExtractedEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: SystemConfig singleton (all columns use schema defaults)
INSERT INTO "SystemConfig" ("id", "updatedAt") VALUES ('singleton', NOW())
ON CONFLICT ("id") DO NOTHING;

