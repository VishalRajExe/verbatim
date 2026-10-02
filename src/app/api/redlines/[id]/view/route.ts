import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderDocxToHtml } from "@/lib/docx/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/redlines/:id/view
 *
 * Returns clean semantic HTML representation of the redlined output DOCX.
 * Renders genuine Word revisions (<w:ins> and <w:del>) visually in the document.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params);
    const redlineId = resolved.id;
    const { searchParams } = new URL(req.url);
    const showRevisions = searchParams.get("revisions") !== "false";

    const redline = await db.redline.findUnique({
      where: { id: redlineId },
      select: {
        id: true,
        documentId: true,
        instruction: true,
        status: true,
        output: true,
      },
    });

    if (!redline) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Redline session not found." } },
        { status: 404 }
      );
    }

    if (!redline.output) {
      return NextResponse.json(
        {
          error: {
            code: "OUTPUT_NOT_READY",
            message: "Redlined document has not been applied yet. No output DOCX is available.",
          },
        },
        { status: 400 }
      );
    }

    const doc = await db.document.findUnique({
      where: { id: redline.documentId },
      select: { name: true },
    });

    const html = renderDocxToHtml(Buffer.from(redline.output), {
      showRevisions,
    });

    const redlinedName = (doc?.name || "document.docx").replace(
      /\.docx$/i,
      "_redlined.docx"
    );

    return NextResponse.json({
      redlineId: redline.id,
      sessionId: redline.id,
      documentId: redline.documentId,
      documentName: redlinedName,
      status: redline.status,
      instruction: redline.instruction,
      html,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}
