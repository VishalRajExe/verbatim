import { db } from "@/lib/db";
import { convertDocxToPdf } from "./convert-docx";
import { extractPdf } from "./extract-pdf";
import { checkScannedPdf } from "./scan-check";
import { stripPageFurniture } from "./strip-furniture";
import { buildCanonicalDocument } from "./build-canonical";
import { extractDocxText } from "@/lib/redline/view";
import { AppError } from "@/lib/errors";

/**
 * Executes the complete ingestion pipeline for a queued document.
 * Implements Architecture.md section 5 and PRD FR-1.
 */
export async function processDocument(documentId: string): Promise<void> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: { file: true },
  });

  if (!doc) {
    throw new AppError("DOC_NOT_FOUND", `Document ${documentId} not found`, 404);
  }

  if (!doc.file) {
    throw new AppError("FILE_CORRUPT", "Document file content is missing", 400);
  }

  try {
    let pdfBuffer: Buffer;

    // DOCX Handling: Read authoritative text directly.
    // Do NOT automatically convert to PDF (user-controlled on demand).
    if (doc.kind === "docx") {
      await db.document.update({
        where: { id: documentId },
        data: {
          status: "INDEXING",
          stage: "Reading authoritative DOCX text",
          progress: 50,
        },
      });

      const docxText = await extractDocxText(Buffer.from(doc.file.original));
      const charCount = docxText.length;
      const tokenEstimate = Math.ceil(charCount / 4);

      await db.documentText.upsert({
        where: { documentId },
        create: { documentId, text: docxText },
        update: { text: docxText },
      });

      await db.document.update({
        where: { id: documentId },
        data: {
          status: "READY",
          stage: "Ready",
          progress: 100,
          pageCount: 1,
          charCount,
          tokenEstimate,
          errorCode: null,
          errorMessage: null,
        },
      });

      return;
    }

    pdfBuffer = Buffer.from(doc.file.original);

    // 2. Extraction stage
    await db.document.update({
      where: { id: documentId },
      data: {
        status: "EXTRACTING",
        stage: "Reading document pages",
        progress: 15,
      },
    });

    let lastProgressUpdate = Date.now();
    const extracted = await extractPdf(pdfBuffer, async (currentPage, totalPages) => {
      // Throttle DB updates during extraction to at most once per 400ms or on the last page
      const now = Date.now();
      if (now - lastProgressUpdate > 400 || currentPage === totalPages) {
        lastProgressUpdate = now;
        const progress = Math.min(75, Math.round(15 + (currentPage / totalPages) * 60));
        await db.document.update({
          where: { id: documentId },
          data: {
            progress,
            stage: `Reading page ${currentPage} of ${totalPages}`,
          },
        });
      }
    });

    // 3. Scan check (Scanned PDF detection)
    const scanResult = checkScannedPdf(extracted.pages);
    if (scanResult.isScanned) {
      await db.document.update({
        where: { id: documentId },
        data: {
          status: "FAILED",
          errorCode: "NO_TEXT_LAYER",
          errorMessage: "no selectable text; OCR is not supported",
          stage: "Can't read this file",
          progress: 100,
        },
      });
      return;
    }

    // 4. Indexing & Canonical building stage
    await db.document.update({
      where: { id: documentId },
      data: {
        status: "INDEXING",
        stage: "Preparing canonical text",
        progress: 80,
      },
    });

    // Strip furniture (headers, footers, bare page numbers)
    const strippedPages = stripPageFurniture(extracted.pages);

    // Build canonical text and geometry index
    const canonical = buildCanonicalDocument(strippedPages);

    // 5. Database transaction: store canonical text, pages, and mark READY.
    // Retry on MySQL deadlocks (P2034) which can occur in test environments.
    const runTx = async () =>
      db.$transaction(async (tx) => {
        await tx.documentText.upsert({
          where: { documentId },
          create: { documentId, text: canonical.canonicalText },
          update: { text: canonical.canonicalText },
        });

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

        const warnings =
          canonical.emptyPages.length > 0
            ? { emptyPages: canonical.emptyPages }
            : undefined;

        await tx.document.update({
          where: { id: documentId },
          data: {
            status: "READY",
            stage: "Ready",
            progress: 100,
            pageCount: canonical.pages.length,
            charCount: canonical.charCount,
            tokenEstimate: canonical.tokenEstimate,
            warnings,
            errorCode: null,
            errorMessage: null,
          },
        });
      });

    // Up to 3 attempts with backoff on deadlock.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await runTx();
        break;
      } catch (txErr: unknown) {
        if (
          txErr &&
          typeof txErr === "object" &&
          "code" in txErr &&
          (txErr as { code: unknown }).code === "P2034" &&
          attempt < 3
        ) {
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        throw txErr;
      }
    }
  } catch (err: unknown) {
    const errObj = err && typeof err === "object" ? err as Record<string, unknown> : {};
    const errorCode = typeof errObj.code === "string" ? errObj.code : "INTERNAL";
    const rawMsg = typeof errObj.message === "string" ? errObj.message
      : (err instanceof Error ? err.message : "An unexpected error occurred during processing.");
    const errorMessage = rawMsg.slice(0, 500);
    await db.document.update({
      where: { id: documentId },
      data: {
        status: "FAILED",
        errorCode: typeof errorCode === "string" ? errorCode : "INTERNAL",
        errorMessage,
        stage: "Processing failed",
      },
    });

    throw err;
  }
}
