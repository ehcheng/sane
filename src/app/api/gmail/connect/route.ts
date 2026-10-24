import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { google } from "googleapis";
import { auth } from "@/server/auth";
import { sanitizeReturnTo } from "@/lib/url-validation";

export const dynamic = "force-dynamic";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const returnTo = sanitizeReturnTo(
      request.nextUrl.searchParams.get("returnTo"),
      "/setup?step=1"
    );

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const payload = JSON.stringify({ userId: session.user.id, returnTo });
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is required");
    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    const state = Buffer.from(JSON.stringify({ payload, signature })).toString(
      "base64"
    );

    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
