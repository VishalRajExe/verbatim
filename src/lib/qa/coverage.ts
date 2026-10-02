/**
 * Coverage object: tracks which chunks and pages were successfully read.
 *
 * I-5: Every answer carries a coverage object. If any section failed or
 * any pages were unreadable, the answer must not claim something does not exist.
 */

export interface CoverageDoc {
  documentId: string;
  documentName: string;
  chunksTotal: number;
  chunksRead: number;
  failedChunks: number[];
  /** Total pages in the document. */
  pages: number;
  /** Pages that had no text (from Document.warnings). */
  unreadablePages: number;
  /** True only if ALL chunks read and no failures. */
  complete: boolean;
}

/** Build an initial coverage object (all chunks unread). */
export function initCoverage(
  documentId: string,
  documentName: string,
  chunksTotal: number,
  pages: number,
  unreadablePages: number
): CoverageDoc {
  return {
    documentId,
    documentName,
    chunksTotal,
    chunksRead: 0,
    failedChunks: [],
    pages,
    unreadablePages,
    complete: false,
  };
}

/** Record a successful chunk read. */
export function markChunkRead(cov: CoverageDoc): CoverageDoc {
  const updated = { ...cov, chunksRead: cov.chunksRead + 1 };
  updated.complete =
    updated.chunksRead === updated.chunksTotal &&
    updated.failedChunks.length === 0;
  return updated;
}

/** Record a failed chunk. */
export function markChunkFailed(cov: CoverageDoc, chunkIndex: number): CoverageDoc {
  const updated = {
    ...cov,
    failedChunks: [...cov.failedChunks, chunkIndex],
  };
  updated.complete = false;
  return updated;
}
