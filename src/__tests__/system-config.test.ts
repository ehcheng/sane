import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";

describe("SystemConfig model", () => {
  it("has the expected shape via Prisma types", () => {
    // Type-level test: if the model shape changes, this won't compile
    const config: Prisma.SystemConfigCreateInput = {
      id: "singleton",
      isMonitoringEnabled: true,
    };
    expect(config.isMonitoringEnabled).toBe(true);
    expect(config.id).toBe("singleton");
  });

  it("defaults isMonitoringEnabled in the type system", () => {
    // Verify the field is optional in create input (has a default)
    const minimal: Prisma.SystemConfigCreateInput = {};
    expect(minimal.isMonitoringEnabled).toBeUndefined();
  });
});
