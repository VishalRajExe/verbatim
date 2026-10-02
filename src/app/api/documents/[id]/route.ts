import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/[id]
 * Fetches a single document's metadata and page details.
 */
export async function GET(
  _req: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const document = await db.document.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        status: true,
        stage: true,
        progress: true,
        pageCount: true,
        charCount: true,
        tokenEstimate: true,
        errorCode: true,
        errorMessage: true,
        warnings: true,
        createdAt: true,
        updatedAt: true,
        pages: {
          select: {
            pageNo: true,
            charStart: true,
            charEnd: true,
            width: true,
            height: true,
          },
          orderBy: { pageNo: "asc" },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
        { status: 404 }
      );
    }

    return NextResponse.json({ document });
  } catch (err: unknown) {
    console.error("[API] Failed to get document:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to load document." } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[id]
 * Cascades to delete Document, DocumentFile, DocumentText, DocumentPage, quotes, etc.
 * Implements PRD FR-1.6.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const existing = await db.document.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
        { status: 404 }
      );
    }

    await db.document.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    console.error("[API] Failed to delete document:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to delete document." } },
      { status: 500 }
    );
  }
}
