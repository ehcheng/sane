/**
 * Centralized config loader.
 * Reads SystemConfig from DB with 60s cache, merges with defaults.
 * All consumers should use getConfig() instead of importing app.config.ts directly.
 */

import { prisma } from "@/server/db/prisma";
import { DEFAULTS } from "../../../app.config.defaults";
import logger from "@/lib/logger";

export interface AppConfig {
  // Worker / Scheduler
  pollIntervalMinutes: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  timezone: string;

  // AI Provider
  aiProvider: string | null;
  aiModel: string | null;
  hasAiApiKey: boolean;

  // AI Prompt Instructions
  aiSystemInstruction: string;
  aiRelevanceInstruction: string;
  aiSummaryInstructionConcise: string;
  aiResponseFormatInstruction: string;
  aiNoSendInstruction: string;
  aiEventExtractionInstruction: string;
  aiBriefSummaryInstruction: string;
  aiLinkExtractionInstruction: string;
  aiBrutalModeInstruction: string;

  // Email Forwarding
  resendFromAddress: string | null;
  hasResendApiKey: boolean;

  // Branding & Footer
  brandName: string;
  brandTagline: string;
  emailFooterEnabled: boolean;
  emailFooterText: string | null;

  // Global Monitoring
  isMonitoringEnabled: boolean;

  // Broadcast
  broadcastActive: boolean;
  broadcastMessage: string | null;
  broadcastEndsAt: Date | null;

  // Recent Activity
  recentActivityLimit: number;

  // Data Retention
  dataRetentionDays: number;
  eventRetentionDays: number;
  feedbackSnapshotRetentionDays: number;
  aiCallLogRetentionDays: number;

  // AI Processing
  aiConcurrency: number;

  // Brief Events
  dailyBriefEventDays: number;

  // Display Features
  showEmailSummaryInEvents: boolean;

  // Debug & Logging
  debugMode: boolean;
  showDebugUI: boolean;
  logDir: string;

  // App URL
  appUrl: string | null;

  // User Lifecycle
  lifecycleEnforcementEnabled: boolean;
}

let cached: { config: AppConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getConfig(): Promise<AppConfig> {
  if (cached && Date.now() < cached.expiresAt) return cached.config;

  let db: Awaited<ReturnType<typeof prisma.systemConfig.findUnique>> = null;
  try {
    db = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
    });
  } catch (err) {
    logger.error("config", `Failed to load config from DB: ${err instanceof Error ? err.message : String(err)}`);
    // Return stale cache if available, otherwise fall through to DEFAULTS
    if (cached) {
      logger.warn("config", "Returning stale cached config");
      return cached.config;
    }
    logger.warn("config", "No cached config available, using DEFAULTS");
  }

  const config: AppConfig = {
    // Worker
    pollIntervalMinutes: db?.pollIntervalMinutes ?? DEFAULTS.pollIntervalMinutes,
    activeHoursStart: db?.activeHoursStart ?? DEFAULTS.activeHoursStart,
    activeHoursEnd: db?.activeHoursEnd ?? DEFAULTS.activeHoursEnd,
    timezone: db?.timezone ?? DEFAULTS.timezone,

    // AI Provider
    aiProvider: db?.aiProvider ?? null,
    aiModel: db?.aiModel ?? null,
    hasAiApiKey: db?.aiApiKeyEncrypted != null,

    // AI Prompts
    aiSystemInstruction: db?.aiSystemInstruction ?? DEFAULTS.aiSystemInstruction,
    aiRelevanceInstruction: db?.aiRelevanceInstruction ?? DEFAULTS.aiRelevanceInstruction,
    aiSummaryInstructionConcise: db?.aiSummaryInstructionConcise ?? DEFAULTS.aiSummaryInstructionConcise,
    aiResponseFormatInstruction: db?.aiResponseFormatInstruction ?? DEFAULTS.aiResponseFormatInstruction,
    aiNoSendInstruction: db?.aiNoSendInstruction ?? DEFAULTS.aiNoSendInstruction,
    aiEventExtractionInstruction: db?.aiEventExtractionInstruction ?? DEFAULTS.aiEventExtractionInstruction,
    aiBriefSummaryInstruction: db?.aiBriefSummaryInstruction ?? DEFAULTS.aiBriefSummaryInstruction,
    aiLinkExtractionInstruction: DEFAULTS.aiLinkExtractionInstruction,
    aiBrutalModeInstruction: DEFAULTS.aiBrutalModeInstruction,

    // Resend
    resendFromAddress: db?.resendFromAddress ?? null,
    hasResendApiKey: db?.resendApiKeyEncrypted != null,

    // Branding & Footer
    brandName: db?.brandName ?? DEFAULTS.brandName,
    brandTagline: db?.brandTagline ?? DEFAULTS.brandTagline,
    emailFooterEnabled: db?.emailFooterEnabled ?? false,
    emailFooterText: db?.emailFooterText ?? null,

    // Global Monitoring
    isMonitoringEnabled: db?.isMonitoringEnabled ?? true,

    // Broadcast
    broadcastActive: db?.broadcastActive ?? false,
    broadcastMessage: db?.broadcastMessage ?? null,
    broadcastEndsAt: db?.broadcastEndsAt ?? null,

    // Recent Activity
    recentActivityLimit: db?.recentActivityLimit ?? DEFAULTS.recentActivityLimit,

    // Data Retention
    dataRetentionDays: db?.dataRetentionDays ?? DEFAULTS.dataRetentionDays,
    eventRetentionDays: db?.eventRetentionDays ?? DEFAULTS.eventRetentionDays,
    feedbackSnapshotRetentionDays: db?.feedbackSnapshotRetentionDays ?? DEFAULTS.feedbackSnapshotRetentionDays,
    aiCallLogRetentionDays: db?.aiCallLogRetentionDays ?? DEFAULTS.aiCallLogRetentionDays,

    // AI Processing
    aiConcurrency: db?.aiConcurrency ?? DEFAULTS.aiConcurrency,

    // Brief Events
    dailyBriefEventDays: db?.dailyBriefEventDays ?? DEFAULTS.dailyBriefEventDays,

    // Display Features
    showEmailSummaryInEvents: db?.showEmailSummaryInEvents ?? DEFAULTS.showEmailSummaryInEvents,

    // Debug
    debugMode: db?.debugMode ?? DEFAULTS.debugMode,
    showDebugUI: db?.showDebugUI ?? DEFAULTS.showDebugUI,
    logDir: db?.logDir ?? DEFAULTS.logDir,

    // App URL
    appUrl: db?.appUrl ?? null,

    // User Lifecycle
    lifecycleEnforcementEnabled: db?.lifecycleEnforcementEnabled ?? false,
  };

  cached = { config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

export function invalidateConfigCache(): void {
  cached = null;
}
