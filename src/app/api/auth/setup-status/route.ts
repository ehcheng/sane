import { NextResponse } from "next/server";
import { needsFirstRunSetup } from "@/lib/setup-check";

export const dynamic = "force-dynamic";

export async function GET() {
  const needsSetup = await needsFirstRunSetup();
  return NextResponse.json({ needsSetup });
}
