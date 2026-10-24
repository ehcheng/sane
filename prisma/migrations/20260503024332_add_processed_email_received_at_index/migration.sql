-- CreateIndex
CREATE INDEX "ProcessedEmail_userId_receivedAt_idx" ON "ProcessedEmail"("userId", "receivedAt");
