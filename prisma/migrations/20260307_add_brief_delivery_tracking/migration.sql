-- CreateTable
CREATE TABLE "BriefDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "briefType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resendMessageId" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "deliveryUpdatedAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefDelivery_briefType_createdAt_idx" ON "BriefDelivery"("briefType", "createdAt");

-- CreateIndex
CREATE INDEX "BriefDelivery_resendMessageId_idx" ON "BriefDelivery"("resendMessageId");

-- CreateIndex
CREATE INDEX "BriefDelivery_userId_createdAt_idx" ON "BriefDelivery"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BriefDelivery" ADD CONSTRAINT "BriefDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
