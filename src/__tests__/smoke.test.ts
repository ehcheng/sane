import { describe, it, expect } from "vitest";
import { briefScopeEnum } from "@/lib/validators";

describe("smoke test", () => {
  it("validates brief scope enum", () => {
    expect(briefScopeEnum.parse("ACTIONABLE")).toBe("ACTIONABLE");
    expect(briefScopeEnum.parse("ALL")).toBe("ALL");
    expect(() => briefScopeEnum.parse("NONE")).toThrow();
  });
});
