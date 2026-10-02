/**
 * GET /api/documents/:id/locate?ranges=s1-e1,s2-e2
 *
 * Converts canonical-text character ranges to per-page rectangles.
 * Architecture.md SS9.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { locate } from "@/lib/verify/locate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolved = await Promise.resolve(params);
  const documentId = resolved.id;

  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, status: true },
  });

  if (!doc) {
    return NextResponse.json(
      { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
      { status: 404 }
    );
  }

  if (doc.status !== "READY") {
    return NextResponse.json(
      { error: { code: "DOC_NOT_READY", message: "Document is not ready yet." } },
      { status: 409 }
    );
  }

  const rangesParam = req.nextUrl.searchParams.get("ranges");
  if (!rangesParam) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Missing required query parameter: ranges" } },
      { status: 400 }
    );
  }

  const ranges: { start: number; end: number }[] = [];
  for (const part of rangesParam.split(",")) {
    const [s, e] = part.trim().split("-").map(Number);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "Invalid range: \"" + part + "\". Expected \"start-end\" where end > start." } },
        { status: 400 }
      );
    }
    ranges.push({ start: s, end: e });
  }

  const highlights = await locate(documentId, ranges);
  return NextResponse.json({ highlights });
}