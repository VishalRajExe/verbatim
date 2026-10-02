import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents/[id]
 * Fetches a single document's metadata and page details.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const document = await db.document.findUnique({
      where: { id: params.id },
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
        { error: "Document not found", code: "DOC_NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ document });
  } catch (err: any) {
    console.error("[API] Failed to get document:", err);
    return NextResponse.json(
      { error: "Internal server error" },
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
  { params }: { params: { id: string } }
) {
  try {
    const existing = await db.document.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Document not found", code: "DOC_NOT_FOUND" },
        { status: 404 }
      );
    }

    await db.document.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[API] Failed to delete document:", err);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}
