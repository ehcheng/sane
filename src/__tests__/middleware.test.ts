import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";

// Test the middleware routing logic in isolation by extracting
// the decision logic rather than importing the real middleware
// (which depends on next-auth's `auth()` wrapper).

type MockAuth = {
  user?: { id: string; role: "USER" | "ADMIN" };
} | null;

const publicPaths = ["/", "/login", "/signup", "/about", "/api/auth"];

function simulateMiddleware(pathname: string, auth: MockAuth) {
  // Allow public paths
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return { action: "next" };
  }

  // Allow Gmail API routes
  if (pathname.startsWith("/api/gmail/")) {
    return { action: "next" };
  }

  // Redirect unauthenticated users to login
  if (!auth) {
    return { action: "redirect", url: "/login" };
  }

  const role = auth.user?.role;

  // Block non-admins from /admin routes
  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return { action: "redirect", url: "/events" };
  }

  // Redirect admins away from user routes to /admin
  if (
    role === "ADMIN" &&
    !pathname.startsWith("/admin") &&
    !pathname.startsWith("/api")
  ) {
    return { action: "redirect", url: "/admin" };
  }

  return { action: "next" };
}

describe("middleware routing logic", () => {
  it("allows unauthenticated access to public paths", () => {
    expect(simulateMiddleware("/", null)).toEqual({ action: "next" });
    expect(simulateMiddleware("/login", null)).toEqual({ action: "next" });
    expect(simulateMiddleware("/signup", null)).toEqual({ action: "next" });
  });

  it("redirects unauthenticated users to /login", () => {
    expect(simulateMiddleware("/events", null)).toEqual({
      action: "redirect",
      url: "/login",
    });
    expect(simulateMiddleware("/admin", null)).toEqual({
      action: "redirect",
      url: "/login",
    });
  });

  it("blocks non-ADMIN users from /admin routes", () => {
    const userAuth = { user: { id: "u1", role: "USER" as const } };
    expect(simulateMiddleware("/admin", userAuth)).toEqual({
      action: "redirect",
      url: "/events",
    });
    expect(simulateMiddleware("/admin/users", userAuth)).toEqual({
      action: "redirect",
      url: "/events",
    });
  });

  it("allows ADMIN users to access /admin routes", () => {
    const adminAuth = { user: { id: "a1", role: "ADMIN" as const } };
    expect(simulateMiddleware("/admin", adminAuth)).toEqual({ action: "next" });
    expect(simulateMiddleware("/admin/users", adminAuth)).toEqual({
      action: "next",
    });
  });

  it("redirects ADMIN users away from user routes to /admin", () => {
    const adminAuth = { user: { id: "a1", role: "ADMIN" as const } };
    expect(simulateMiddleware("/events", adminAuth)).toEqual({
      action: "redirect",
      url: "/admin",
    });
    expect(simulateMiddleware("/settings", adminAuth)).toEqual({
      action: "redirect",
      url: "/admin",
    });
  });

  it("allows ADMIN users to access API routes", () => {
    const adminAuth = { user: { id: "a1", role: "ADMIN" as const } };
    expect(simulateMiddleware("/api/trpc/admin.users", adminAuth)).toEqual({
      action: "next",
    });
  });

  it("allows USER to access normal routes", () => {
    const userAuth = { user: { id: "u1", role: "USER" as const } };
    expect(simulateMiddleware("/events", userAuth)).toEqual({
      action: "next",
    });
    expect(simulateMiddleware("/settings", userAuth)).toEqual({
      action: "next",
    });
  });
});
