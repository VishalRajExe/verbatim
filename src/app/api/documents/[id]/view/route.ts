import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderDocxToHtml } from "@/lib/docx/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/documents/:id/view
 *
 * Returns clean semantic HTML representation of the document for in-app viewing.
 * For DOCX: renders original DOCX with headings, tables, bold, lists, and formatting.
 * For PDF: returns metadata indicating PDF rendition is available.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params);
    const documentId = resolved.id;
    const { searchParams } = new URL(req.url);
    const showRevisions = searchParams.get("revisions") !== "false";

    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        name: true,
        kind: true,
        status: true,
        file: {
          select: {
            original: true,
            rendition: true,
          },
        },
      },
    });

    if (!doc) {
      return NextResponse.json(
        { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
        { status: 404 }
      );
    }

    if (doc.kind === "docx") {
      if (!doc.file?.original) {
        return NextResponse.json(
          { error: { code: "FILE_MISSING", message: "Document file content not found." } },
          { status: 404 }
        );
      }

      const html = renderDocxToHtml(Buffer.from(doc.file.original), {
        showRevisions,
      });

      return NextResponse.json({
        documentId: doc.id,
        documentName: doc.name,
        kind: "docx",
        hasPdfRendition: !!doc.file?.rendition,
        html,
      });
    }

    // PDF document
    return NextResponse.json({
      documentId: doc.id,
      documentName: doc.name,
      kind: "pdf",
      hasPdfRendition: true,
      html: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}
