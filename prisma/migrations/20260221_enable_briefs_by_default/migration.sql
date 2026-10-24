-- Change default for dailyBriefEnabled and weeklyBriefEnabled to true
ALTER TABLE "User" ALTER COLUMN "dailyBriefEnabled" SET DEFAULT true;
ALTER TABLE "User" ALTER COLUMN "weeklyBriefEnabled" SET DEFAULT true;

-- Update existing users who still have the old defaults
UPDATE "User" SET "dailyBriefEnabled" = true WHERE "dailyBriefEnabled" = false;
UPDATE "User" SET "weeklyBriefEnabled" = true WHERE "weeklyBriefEnabled" = false;
