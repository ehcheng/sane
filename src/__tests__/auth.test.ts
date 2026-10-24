import { describe, it, expect } from "vitest";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

// Re-create the middleware logic here to test it in isolation,
// since the real trpc.ts imports `auth` which requires Next.js runtime.
type MockSession = {
  user: {
    id: string;
    role: "USER" | "ADMIN";
    name?: string;
    email?: string;
  };
} | null;

function createTestTRPC(session: MockSession) {
  const t = initTRPC.context<{ session: MockSession }>().create({
    transformer: superjson,
  });

  const enforceAuth = t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        session: ctx.session,
        userId: ctx.session.user.id,
      },
    });
  });

  const enforceAdmin = t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (ctx.session.user.role !== "ADMIN") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return next({
      ctx: {
        session: ctx.session,
        userId: ctx.session.user.id,
      },
    });
  });

  const protectedProcedure = t.procedure.use(enforceAuth);
  const adminProcedure = t.procedure.use(enforceAdmin);

  const router = t.router({
    protectedRoute: protectedProcedure.query(({ ctx }) => ({
      userId: ctx.userId,
    })),
    adminRoute: adminProcedure.query(({ ctx }) => ({
      userId: ctx.userId,
    })),
  });

  const caller = t.createCallerFactory(router)({ session });
  return caller;
}

describe("enforceAuth middleware", () => {
  it("passes when user is authenticated", async () => {
    const caller = createTestTRPC({
      user: { id: "user-1", role: "USER" },
    });
    const result = await caller.protectedRoute();
    expect(result.userId).toBe("user-1");
  });

  it("throws UNAUTHORIZED when session is null", async () => {
    const caller = createTestTRPC(null);
    await expect(caller.protectedRoute()).rejects.toThrow(TRPCError);
    await expect(caller.protectedRoute()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("enforceAdmin middleware", () => {
  it("passes when user has ADMIN role", async () => {
    const caller = createTestTRPC({
      user: { id: "admin-1", role: "ADMIN" },
    });
    const result = await caller.adminRoute();
    expect(result.userId).toBe("admin-1");
  });

  it("throws FORBIDDEN when user has USER role", async () => {
    const caller = createTestTRPC({
      user: { id: "user-1", role: "USER" },
    });
    await expect(caller.adminRoute()).rejects.toThrow(TRPCError);
    await expect(caller.adminRoute()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("throws UNAUTHORIZED when session is null", async () => {
    const caller = createTestTRPC(null);
    await expect(caller.adminRoute()).rejects.toThrow(TRPCError);
    await expect(caller.adminRoute()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("USER can still access protected routes", async () => {
    const caller = createTestTRPC({
      user: { id: "user-1", role: "USER" },
    });
    const result = await caller.protectedRoute();
    expect(result.userId).toBe("user-1");
  });
});
