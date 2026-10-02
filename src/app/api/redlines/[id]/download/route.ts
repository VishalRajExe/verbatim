import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/redlines/:id/download
 * Downloads the modified DOCX with real Word tracked changes.
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

    if (redline.status !== "APPLIED" || !redline.output) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_APPLIED",
            message:
              "Tracked changes have not been applied yet. Please apply approved edits first.",
          },
        },
        { status: 400 }
      );
    }

    const doc = await db.document.findUnique({
      where: { id: redline.documentId },
      select: { name: true },
    });

    const baseName = (doc?.name || "document").replace(/\.[^/.]+$/, "");
    const filename = `${baseName}-redlined.docx`;

    const buffer = Buffer.from(redline.output);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          filename
        )}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}
