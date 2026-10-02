/**
 * DOCX Text View (FR-8).
 *
 * Extracts the authoritative plain text view of a DOCX using @adeu/core.
 * This text view (not the converted PDF text) is the ground truth for
 * matching target passages and proposing tracked changes (Architecture §11).
 */

import { extractTextFromBuffer } from "@adeu/core";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface DocxTextViewResult {
  text: string;
  buffer: Buffer;
  documentName: string;
}

/**
 * Extracts the plain text view of a DOCX buffer using Adeu.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  return await extractTextFromBuffer(buffer, false);
}

/**
 * Loads the original DOCX file for a document and extracts its text view.
 */
export async function getDocxTextView(documentId: string): Promise<DocxTextViewResult> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, name: true, kind: true, status: true },
  });

  if (!document) {
    throw new AppError("DOC_NOT_FOUND", "Document not found", 404);
  }

  if (document.kind !== "docx") {
    throw new AppError(
      "UNSUPPORTED_FILE_TYPE",
      "Tracked-change redlining is only available for DOCX documents. PDFs do not support Word revisions.",
      400
    );
  }

  const docFile = await db.documentFile.findUnique({
    where: { documentId },
    select: { original: true },
  });

  if (!docFile || !docFile.original) {
    throw new AppError("DOC_NOT_FOUND", "Original DOCX file data not found in storage", 404);
  }

  const buffer = Buffer.from(docFile.original);
  const text = await extractDocxText(buffer);

  return {
    text,
    buffer,
    documentName: document.name,
  };
}
