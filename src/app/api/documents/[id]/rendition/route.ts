/**
 * GET /api/documents/:id/rendition
 *
 * Returns the PDF representation of the document:
 * - For PDF documents: returns the original PDF.
 * - For DOCX documents: returns the headless LibreOffice converted PDF rendition.
 *
 * Supports HTTP Range requests and inline display headers for PDF.js.
 * Architecture.md §9, PRD FR-5.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const documentId = params.id;

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

  if (doc.status !== "READY") {
    return NextResponse.json(
      {
        error: {
          code: "DOC_NOT_READY",
          message: `Document is not ready yet (current status: ${doc.status}).`,
        },
      },
      { status: 409 }
    );
  }

  let pdfBytes: Buffer | null = null;
  if (doc.kind === "pdf") {
    pdfBytes = doc.file?.original ? Buffer.from(doc.file.original) : null;
  } else if (doc.kind === "docx") {
    pdfBytes = doc.file?.rendition ? Buffer.from(doc.file.rendition) : null;
  }

  if (!pdfBytes || pdfBytes.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: "RENDITION_NOT_AVAILABLE",
          message: "PDF rendition is not available for this document.",
        },
      },
      { status: 404 }
    );
  }

  const totalLength = pdfBytes.length;
  const fileName = doc.name.replace(/\.[^/.]+$/, "") + ".pdf";

  // Check for HTTP Range header
  const rangeHeader = req.headers.get("range");
  if (rangeHeader && rangeHeader.startsWith("bytes=")) {
    const parts = rangeHeader.slice("bytes=".length).split("-");
    const startStr = parts[0].trim();
    const endStr = parts[1]?.trim();

    let start = startStr ? parseInt(startStr, 10) : 0;
    let end = endStr ? parseInt(endStr, 10) : totalLength - 1;

    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= totalLength) end = totalLength - 1;

    if (start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${totalLength}`,
        },
      });
    }

    const chunk = pdfBytes.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Range": `bytes ${start}-${end}/${totalLength}`,
        "Content-Length": String(chunk.length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(totalLength),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
