import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { getConfig } from "@/server/config";

/**
 * GET /api/household/accept?token=...
 *
 * Clicked from the invite email. If the user is logged in, redirect them
 * to the settings page with the token so the UI can trigger acceptInvite.
 * If not logged in, redirect to login with a return URL.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const session = await auth();
  const returnPath = `/settings?accept-invite=${encodeURIComponent(token)}#family`;

  const config = await getConfig();
  const origin = config.appUrl || process.env.NEXTAUTH_URL || request.nextUrl.origin;

  if (!session?.user?.id) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("callbackUrl", returnPath);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(returnPath, origin));
}
