-- AlterTable: Add lifecycle enforcement toggle to SystemConfig
ALTER TABLE "SystemConfig" ADD COLUMN "lifecycleEnforcementEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add lifecycle email counter to User
ALTER TABLE "User" ADD COLUMN "lifecycleEmailsSent" INTEGER NOT NULL DEFAULT 0;
