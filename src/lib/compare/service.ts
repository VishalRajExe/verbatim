/**
 * Comparison Service (FR-7).
 *
 * Handles execution and database persistence of document comparisons:
 * - Fetches canonical text for older and newer documents
 * - Runs comparison pipeline with live stage progress updates
 * - Persists Comparison and ComparisonChange records
 * - Supports restart recovery and status polling
 */

import { db } from "@/lib/db";
import { runComparisonPipeline } from "./pipeline";

export async function processComparison(comparisonId: string): Promise<void> {
  const comparison = await db.comparison.findUnique({
    where: { id: comparisonId },
  });

  if (!comparison) {
    console.error(`[CompareService] Comparison not found: ${comparisonId}`);
    return;
  }

  try {
    // 1. Mark as RUNNING
    await db.comparison.update({
      where: { id: comparisonId },
      data: {
        status: "RUNNING",
        stage: "Loading documents",
        errorMessage: null,
      },
    });

    // 2. Fetch canonical text for both documents
    const [docA, docB, textAEntry, textBEntry] = await Promise.all([
      db.document.findUnique({ where: { id: comparison.docAId }, select: { id: true, name: true, status: true } }),
      db.document.findUnique({ where: { id: comparison.docBId }, select: { id: true, name: true, status: true } }),
      db.documentText.findUnique({ where: { documentId: comparison.docAId }, select: { text: true } }),
      db.documentText.findUnique({ where: { documentId: comparison.docBId }, select: { text: true } }),
    ]);

    if (!docA || !docB) {
      throw new Error("One or both documents do not exist.");
    }

    if (docA.status !== "READY" || docB.status !== "READY") {
      throw new Error(`Both documents must be READY. Doc A: ${docA.status}, Doc B: ${docB.status}`);
    }

    if (!textAEntry?.text || !textBEntry?.text) {
      throw new Error("Canonical text could not be loaded for one or both documents.");
    }

    // 3. Run comparison pipeline with live progress
    const result = await runComparisonPipeline(textAEntry.text, textBEntry.text, {
      onProgress: async (stage) => {
        await db.comparison.update({
          where: { id: comparisonId },
          data: { stage },
        });
      },
    });

    // 4. Save results transactionally
    await db.$transaction(async (tx) => {
      // Remove any previous changes for this comparison
      await tx.comparisonChange.deleteMany({
        where: { comparisonId },
      });

      // Insert changes
      if (result.changes.length > 0) {
        await tx.comparisonChange.createMany({
          data: result.changes.map((c) => ({
            comparisonId,
            orderIdx: c.orderIdx,
            type: c.type,
            significance: c.significance,
            category: c.category,
            title: c.title,
            summary: c.summary,
            summarySource: c.summarySource,
            aText: c.aText,
            bText: c.bText,
            aStart: c.aStart,
            aEnd: c.aEnd,
            bStart: c.bStart,
            bEnd: c.bEnd,
          })),
        });
      }

      // Update comparison status to READY
      await tx.comparison.update({
        where: { id: comparisonId },
        data: {
          status: "READY",
          stage: "Ready",
          summary: result.summary,
          stats: result.stats as any,
          errorMessage: null,
        },
      });
    });

    console.log(`[CompareService] Comparison completed successfully: ${comparisonId} (${result.changes.length} changes)`);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[CompareService] Comparison failed for ${comparisonId}:`, err);
    await db.comparison.update({
      where: { id: comparisonId },
      data: {
        status: "FAILED",
        stage: "Failed",
        errorMessage: errorMsg,
      },
    });
  }
}
