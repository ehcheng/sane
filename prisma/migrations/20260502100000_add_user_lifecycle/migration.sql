-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'WARNING', 'DEACTIVATED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "lastActiveAt" TIMESTAMP(3),
ADD COLUMN "inactivityNotifiedAt" TIMESTAMP(3),
ADD COLUMN "deactivatedAt" TIMESTAMP(3),
ADD COLUMN "reactivatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");
