import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { generateICSFeed } from "@/lib/ics";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import { trackActivity } from "@/server/activity-tracker";

const limiter = createRateLimiter("calendar-feed", {
  windowMs: 60 * 1000,
  maxRequests: 30,
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
  const ip = getClientIp(_request);
  const { allowed, retryAfterMs } = limiter.check(ip);
  if (!allowed) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    });
  }

  const { token } = params;

  if (!token || token.length < 10) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Look up user by calendar token, resolve household for shared events
  const user = await prisma.user.findUnique({
    where: { calendarToken: token },
    select: {
      id: true,
      timezone: true,
      actionableEventsOnly: true,
      accountStatus: true,
      lastActiveAt: true,
      lastCalendarAccessAt: true,
      household: { select: { primaryUserId: true } },
    },
  });

  if (!user) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Deactivated users get an empty calendar feed (no 404 to avoid calendar app errors)
  if (user.accountStatus === "DEACTIVATED") {
    const emptyIcs = generateICSFeed([], { timezone: user.timezone });
    return new NextResponse(emptyIcs, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Disposition": 'inline; filename="sane-events.ics"',
      },
    });
  }

  // Throttled activity tracking (shared helper, at most once per hour)
  trackActivity(user.id, user.lastActiveAt);

  // Track ICS access separately (throttled: skip if accessed within the last hour)
  if (!user.lastCalendarAccessAt || Date.now() - user.lastCalendarAccessAt.getTime() > 60 * 60 * 1000) {
    prisma.user
      .update({ where: { id: user.id }, data: { lastCalendarAccessAt: new Date() } })
      .catch(() => {});
  }

  // Use household primary's ID for event queries (shared data pool)
  const effectiveUserId = user.household?.primaryUserId ?? user.id;

  // Fetch events: past 30 days + next 90 days
  const now = new Date();
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - 30);
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 90);

  const events = await prisma.extractedEvent.findMany({
    where: {
      userId: effectiveUserId,
      deletedAt: null,
      eventDate: { gte: past, lte: future },
      OR: [
        { processedEmailId: null },
        user.actionableEventsOnly
          ? { actionable: true }
          : { processedEmail: { aiRelevant: true } },
      ],
    },
    orderBy: { eventDate: "asc" },
    select: {
      id: true,
      title: true,
      eventDate: true,
      endDate: true,
      allDay: true,
      isTodo: true,
      isDone: true,
      location: true,
      details: true,
      createdAt: true,
      updatedAt: true,
      children: true,
      processedEmail: { select: { aiLinks: true } },
    },
  });

  const { decryptChildRecord } = await import("@/lib/pii-encryption");
  const icsEvents = await Promise.all(
    events.map(async (e) => {
      const decryptedChildren = await Promise.all(
        e.children.map((c) => decryptChildRecord(c))
      );
      const childName = decryptedChildren.map((c) => c.name).join(", ") || null;
      const descParts: string[] = [];
      if (childName) descParts.push(`Children: ${childName}`);
      if (e.details) descParts.push(e.details);

      // Append actionable links in plaintext
      if (e.processedEmail?.aiLinks) {
        try {
          const links = JSON.parse(e.processedEmail.aiLinks) as { url: string; label: string }[];
          if (links.length > 0) {
            const linkLines = links.map((l) => `${l.label}: ${l.url}`).join("\n");
            descParts.push(`Links:\n${linkLines}`);
          }
        } catch { /* ignore malformed JSON */ }
      }

      return {
        id: e.id,
        title: e.title,
        eventDate: e.eventDate,
        endDate: e.endDate,
        allDay: e.allDay,
        isTodo: e.isTodo,
        isDone: e.isDone,
        location: e.location,
        details: e.details,
        childName,
        description: descParts.length > 0 ? descParts.join("\n") : null,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      };
    })
  );

  const ics = generateICSFeed(icsEvents, { timezone: user.timezone });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Disposition": 'inline; filename="sane-events.ics"',
    },
  });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
