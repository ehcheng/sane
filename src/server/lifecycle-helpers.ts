import type { AccountStatus } from "@prisma/client";

/** Data payload to reset a user from WARNING/DEACTIVATED back to ACTIVE. */
export function getReactivationData(): {
  accountStatus: AccountStatus;
  lastActiveAt: Date;
  reactivatedAt: Date;
  deactivatedAt: null;
  inactivityNotifiedAt: null;
  lifecycleEmailsSent: number;
  isMonitoringEnabled: boolean;
} {
  return {
    accountStatus: "ACTIVE",
    lastActiveAt: new Date(),
    reactivatedAt: new Date(),
    deactivatedAt: null,
    inactivityNotifiedAt: null,
    lifecycleEmailsSent: 0,
    isMonitoringEnabled: true,
  };
}
