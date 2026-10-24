-- CreateTable
CREATE TABLE "PriorityActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(75) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriorityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriorityActivity_userId_idx" ON "PriorityActivity"("userId");

-- AddForeignKey
ALTER TABLE "PriorityActivity" ADD CONSTRAINT "PriorityActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
