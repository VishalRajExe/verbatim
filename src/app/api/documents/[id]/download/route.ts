import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/documents/:id/download
 *
 * Downloads the original uploaded file (DOCX or PDF).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params);
    const documentId = resolved.id;

    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        name: true,
        kind: true,
        file: {
          select: {
            original: true,
          },
        },
      },
    });

    if (!doc || !doc.file?.original) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Document file not found." } },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(doc.file.original);
    const contentType =
      doc.kind === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.name)}"`,
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
