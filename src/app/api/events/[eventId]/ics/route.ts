import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { generateICS } from "@/lib/ics";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

const limiter = createRateLimiter("event-ics", {
  windowMs: 60 * 1000,
  maxRequests: 30,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const ip = getClientIp(_req);
  const { allowed, retryAfterMs } = limiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve effectiveUserId from DB (not JWT cache) for household consistency
  const authUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { household: { select: { primaryUserId: true } } },
  });
  const effectiveUserId = authUser?.household?.primaryUserId ?? session.user.id;

  const event = await prisma.extractedEvent.findFirst({
    where: { id: params.eventId, userId: effectiveUserId, deletedAt: null },
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
      processedEmail: { select: { aiSummary: true, aiLinks: true } },
      children: true,
      user: { select: { timezone: true } },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Build rich description: child names + details + AI summary
  const { decryptChildRecord } = await import("@/lib/pii-encryption");
  const decryptedChildren = await Promise.all(
    event.children.map((c) => decryptChildRecord(c))
  );
  const childNames = decryptedChildren.map((c) => c.name).join(", ");

  const descParts: string[] = [];
  if (childNames) descParts.push(`Children: ${childNames}`);
  if (event.details) descParts.push(event.details);
  if (event.processedEmail?.aiSummary) descParts.push(event.processedEmail.aiSummary);

  // Append actionable links in plaintext
  if (event.processedEmail?.aiLinks) {
    try {
      const links = JSON.parse(event.processedEmail.aiLinks) as { url: string; label: string }[];
      if (links.length > 0) {
        const linkLines = links.map((l) => `${l.label}: ${l.url}`).join("\n");
        descParts.push(`Links:\n${linkLines}`);
      }
    } catch { /* ignore malformed JSON */ }
  }

  const ics = generateICS({
    uid: `${event.id}@sane`,
    title: event.title,
    eventDate: event.eventDate,
    endDate: event.endDate,
    allDay: event.allDay,
    isTodo: event.isTodo,
    isDone: event.isDone,
    location: event.location,
    description: descParts.length > 0 ? descParts.join("\n\n") : null,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    timezone: event.user?.timezone,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.title.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 50)}.ics"`,
    },
  });
}
