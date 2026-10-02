/**
 * Coverage object: tracks which chunks and pages were successfully read.
 *
 * Rules (PRD FR-4, Architecture §8, Rules I-5):
 * - Every answer carries a coverage object.
 * - Tracks total sections (chunksTotal), successful sections (chunksRead),
 *   failed sections (failedChunks), and unreadable pages.
 * - complete = true ONLY when all required sections succeeded and no unreadable pages exist.
 * - If coverage is not complete, the application MUST NOT claim something does not exist.
 */

export interface CoverageDoc {
  documentId: string;
  documentName: string;
  /** Total sections the document was divided into. */
  chunksTotal: number;
  /** Number of sections successfully read. */
  chunksRead: number;
  /** 0-based indices of any sections that failed extraction. */
  failedChunks: number[];
  /** Total pages in the document. */
  pages: number;
  /** Pages that had no text / could not be read. */
  unreadablePages: number;
  /** True only if ALL sections succeeded AND no unreadable pages exist. */
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
  const updatedRead = cov.chunksRead + 1;
  const isComplete =
    updatedRead === cov.chunksTotal &&
    cov.failedChunks.length === 0 &&
    cov.unreadablePages === 0;

  return {
    ...cov,
    chunksRead: updatedRead,
    complete: isComplete,
  };
}

/** Record a failed chunk. */
export function markChunkFailed(cov: CoverageDoc, chunkIndex: number): CoverageDoc {
  const updatedFailed = cov.failedChunks.includes(chunkIndex)
    ? cov.failedChunks
    : [...cov.failedChunks, chunkIndex];

  return {
    ...cov,
    failedChunks: updatedFailed,
    complete: false,
  };
}

/** Check if coverage is incomplete or carries caveats. */
export function hasCoverageCaveat(cov: CoverageDoc): boolean {
  return !cov.complete || cov.unreadablePages > 0 || cov.failedChunks.length > 0;
}
