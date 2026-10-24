import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import logger from "@/lib/logger";
import { errorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { signupCodeEnabled: true },
    });
    return NextResponse.json({
      codeRequired: config?.signupCodeEnabled ?? false,
    });
  } catch (error) {
    logger.error("signup-config", "Failed to load signup config", {
      error: errorMessage(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
