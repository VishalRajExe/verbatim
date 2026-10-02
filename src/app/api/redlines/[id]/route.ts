import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/redlines/:id
 * Fetches an existing redline session by ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params);
    const redlineId = resolved.id;

    const redline = await db.redline.findUnique({
      where: { id: redlineId },
      select: {
        id: true,
        documentId: true,
        instruction: true,
        status: true,
        edits: true,
        createdAt: true,
      },
    });

    if (!redline) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Redline session not found." } },
        { status: 404 }
      );
    }

    const doc = await db.document.findUnique({
      where: { id: redline.documentId },
      select: { name: true },
    });

    const enriched = {
      ...redline,
      documentName: doc?.name || "Contract.docx",
      outputAvailable: redline.status === "APPLIED",
    };

    return NextResponse.json({ redline: enriched, session: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}
