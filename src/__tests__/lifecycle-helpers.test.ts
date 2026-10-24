import { describe, it, expect } from "vitest";
import { getReactivationData } from "@/server/lifecycle-helpers";

describe("getReactivationData", () => {
  it("returns accountStatus ACTIVE", () => {
    const data = getReactivationData();
    expect(data.accountStatus).toBe("ACTIVE");
  });

  it("returns isMonitoringEnabled true", () => {
    const data = getReactivationData();
    expect(data.isMonitoringEnabled).toBe(true);
  });

  it("returns deactivatedAt and inactivityNotifiedAt as null", () => {
    const data = getReactivationData();
    expect(data.deactivatedAt).toBeNull();
    expect(data.inactivityNotifiedAt).toBeNull();
  });

  it("returns lifecycleEmailsSent 0", () => {
    const data = getReactivationData();
    expect(data.lifecycleEmailsSent).toBe(0);
  });

  it("lastActiveAt and reactivatedAt are Date instances close to now", () => {
    const before = Date.now();
    const data = getReactivationData();
    const after = Date.now();

    expect(data.lastActiveAt).toBeInstanceOf(Date);
    expect(data.reactivatedAt).toBeInstanceOf(Date);

    expect(data.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.lastActiveAt.getTime()).toBeLessThanOrEqual(after);
    expect(data.reactivatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.reactivatedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
