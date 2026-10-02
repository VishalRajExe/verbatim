/**
 * Apply Tracked-Change Redlines (PRD FR-8, Architecture §11).
 *
 * Applies user-approved, verified redline edits using @adeu/core RedlineEngine.
 * Generates genuine Word tracked-change revisions (w:ins / w:del) with author REDLINE_AUTHOR.
 * Validates output buffer and stores result in database.
 */

import { DocumentObject, RedlineEngine } from "@adeu/core";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { validateDocxRedline, DocxValidationResult } from "./validate-docx";
import type { RedlineVerifiedEdit } from "./verify-edits";

export interface ApplyRedlinesOptions {
  includeIds?: string[];
}

export interface ApplyRedlinesResult {
  redlineId: string;
  status: string;
  editsAppliedCount: number;
  validation: DocxValidationResult;
  outputBuffer: Buffer;
}

/**
 * Applies approved redlines to a DOCX document and saves the modified buffer.
 */
export async function applyRedlines(
  redlineId: string,
  options?: ApplyRedlinesOptions
): Promise<ApplyRedlinesResult> {
  const redline = await db.redline.findUnique({
    where: { id: redlineId },
  });

  if (!redline) {
    throw new AppError("DOC_NOT_FOUND", "Redline session not found", 404);
  }

  const edits = (redline.edits as unknown as RedlineVerifiedEdit[]) || [];
  const includeIds = options?.includeIds;

  // Filter verified edits to apply
  const editsToApply = edits.filter((e) => {
    if (!e.verified) return false;
    if (includeIds) {
      return includeIds.includes(e.id);
    }
    return e.include;
  });

  if (editsToApply.length === 0) {
    throw new AppError(
      "VALIDATION",
      "No verified edits were selected to apply",
      400
    );
  }

  // Load original DOCX buffer from storage
  const docFile = await db.documentFile.findUnique({
    where: { documentId: redline.documentId },
    select: { original: true },
  });

  if (!docFile || !docFile.original) {
    throw new AppError("DOC_NOT_FOUND", "Original DOCX file not found in storage", 404);
  }

  const origBuffer = Buffer.from(docFile.original);

  // Load DocumentObject and RedlineEngine from @adeu/core
  const doc = await DocumentObject.load(origBuffer);
  const author = env.REDLINE_AUTHOR || "Verbatim AI";
  const engine = new RedlineEngine(doc, author);

  // Prepare batch of modifications
  const batch = editsToApply.map((e) => ({
    type: "modify" as const,
    target_text: e.target,
    new_text: e.replacement,
    match_mode: "strict" as const,
    ...(e.matchedClause ? { _match_start_index: e.matchStartIndex } : {}),
  }));

  const report = engine.process_batch(batch);

  // Save modified DOCX buffer
  const savedUint8 = await doc.save();
  const outputBuffer = Buffer.from(savedUint8);

  // Run full validation suite (OOXML ins/del, untouched paragraph diff, LibreOffice smoke test)
  const validation = await validateDocxRedline(
    origBuffer,
    outputBuffer,
    editsToApply.length
  );

  if (!validation.libreOfficeSmokeTestPassed) {
    throw new AppError(
      "FILE_CORRUPT",
      `DOCX validation failed: Document could not be opened cleanly by LibreOffice (${validation.errors.join(", ")})`,
      500
    );
  }

  // Update DB record with APPLIED status and output blob
  const updatedEdits = edits.map((e) => ({
    ...e,
    include: includeIds ? includeIds.includes(e.id) : e.include,
  }));

  await db.redline.update({
    where: { id: redlineId },
    data: {
      status: "APPLIED",
      edits: updatedEdits as any,
      output: outputBuffer,
    },
  });

  return {
    redlineId: redline.id,
    status: "APPLIED",
    editsAppliedCount: report.edits_applied ?? editsToApply.length,
    validation,
    outputBuffer,
  };
}
