import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { convertDocxToPdf } from "@/lib/ingest/convert-docx";
import { extractPdf } from "@/lib/ingest/extract-pdf";
import { checkScannedPdf } from "@/lib/ingest/scan-check";
import { stripPageFurniture } from "@/lib/ingest/strip-furniture";
import { buildCanonicalDocument } from "@/lib/ingest/build-canonical";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/documents/:id/convert-pdf
 *
 * Explicit user-triggered conversion from DOCX to PDF.
 * Converts the original DOCX using LibreOffice headless and creates the PDF rendition
 * along with page geometries for PDF-style viewing and citation highlighting.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolved = await Promise.resolve(params);
  const documentId = resolved.id;

  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { file: true },
  });

  if (!doc) {
    return NextResponse.json(
      { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
      { status: 404 }
    );
  }

  if (doc.kind !== "docx") {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_FILE_TYPE",
          message: "Only DOCX documents require PDF conversion.",
        },
      },
      { status: 400 }
    );
  }

  if (!doc.file?.original) {
    return NextResponse.json(
      { error: { code: "FILE_MISSING", message: "Document file is missing." } },
      { status: 400 }
    );
  }

  // If already converted, return immediately
  if (doc.file.rendition && doc.file.rendition.length > 0) {
    return NextResponse.json({
      success: true,
      alreadyConverted: true,
      message: "Document already converted to PDF.",
    });
  }

  try {
    // 1. Stage: Converting DOCX to PDF
    await db.document.update({
      where: { id: documentId },
      data: {
        stage: "Converting DOCX to PDF",
        progress: 10,
      },
    });

    const pdfBuffer = await convertDocxToPdf(Buffer.from(doc.file.original));

    // Save PDF rendition buffer
    await db.documentFile.update({
      where: { documentId },
      data: { rendition: new Uint8Array(pdfBuffer) },
    });

    // 2. Stage: Reading document pages
    await db.document.update({
      where: { id: documentId },
      data: {
        stage: "Reading document pages",
        progress: 30,
      },
    });

    const extracted = await extractPdf(pdfBuffer);

    // 3. Scan check
    const scanResult = checkScannedPdf(extracted.pages);
    if (scanResult.isScanned) {
      throw new AppError(
        "NO_TEXT_LAYER",
        "Converted PDF has no selectable text layer.",
        400
      );
    }

    // 4. Stage: Preparing canonical text & geometry
    await db.document.update({
      where: { id: documentId },
      data: {
        stage: "Preparing canonical text",
        progress: 80,
      },
    });

    const strippedPages = stripPageFurniture(extracted.pages);
    const canonical = buildCanonicalDocument(strippedPages);

    // 5. Store pages and update document metadata
    await db.$transaction(async (tx) => {
      await tx.documentPage.deleteMany({ where: { documentId } });

      await tx.documentPage.createMany({
        data: canonical.pages.map((p) => ({
          documentId,
          pageNo: p.pageNo,
          charStart: p.charStart,
          charEnd: p.charEnd,
          width: p.width,
          height: p.height,
          items: p.items as unknown as object,
        })),
      });

      await tx.document.update({
        where: { id: documentId },
        data: {
          status: "READY",
          stage: "Ready",
          progress: 100,
          pageCount: canonical.pages.length,
        },
      });
    });

    return NextResponse.json({
      success: true,
      converted: true,
      pageCount: canonical.pages.length,
    });
  } catch (err: unknown) {
    console.error(`[PDF Conversion] Failed for document ${documentId}:`, err);

    // Keep the document in READY status so DOCX viewing and redlining remain available!
    await db.document.update({
      where: { id: documentId },
      data: {
        status: "READY",
        stage: "Ready",
        progress: 100,
      },
    });

    const message =
      err instanceof AppError
        ? err.message
        : "PDF conversion failed. Your original DOCX is still available.";

    return NextResponse.json(
      {
        error: {
          code: "CONVERSION_FAILED",
          message,
        },
      },
      { status: 500 }
    );
  }
}
