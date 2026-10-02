import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isLlmConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus: "available" | "unavailable" = "unavailable";

  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = "available";
  } catch (error) {
    dbStatus = "unavailable";
  }

  const llmStatus: "configured" | "unconfigured" = isLlmConfigured()
    ? "configured"
    : "unconfigured";

  const isHealthy = dbStatus === "available";

  return NextResponse.json(
    {
      status: isHealthy ? "ok" : "degraded",
      database: dbStatus,
      llm: llmStatus,
      timestamp: new Date().toISOString(),
    },
    { status: isHealthy ? 200 : 503 }
  );
}
