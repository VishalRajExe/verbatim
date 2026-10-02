/**
 * verifyQuote() - the core of the Verbatim project (Architecture.md SS7, FR-3).
 *
 * Takes a quote string and a document id.
 * Searches for the quote in the document canonical text using exact substring
 * matching over three views (keep, join, loose).
 * Returns occurrence list, page ranges, and the primary occurrence.
 *
 * INVARIANTS (non-negotiable):
 *  I-1: Only server-verified quotes may be shown as Verified.
 *  I-2: No model-reported positions are ever read.
 *  I-4: No fuzzy / semantic matching. Exact substring search only.
 *  I-7: Verified against the attributed document only.
 */
import { db } from "@/lib/db";
import { normalise, keepView, joinView, looseKey, NormView } from "@/lib/text/normalize";
import { getViews } from "@/lib/text/views";
import { splitEllipsis } from "./split-ellipsis";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MatchKind = "exact" | "loose";
export type FailReason = "TOO_SHORT" | "TOO_LONG" | "NOT_FOUND" | "WRONG_DOCUMENT";

export interface Occurrence {
  /** Canonical-text character start (inclusive). */
  start: number;
  /** Canonical-text character end (exclusive). */
  end: number;
  /** 1-based page number where occurrence begins. */
  pageStart: number;
  /** 1-based page number where occurrence ends. */
  pageEnd: number;
}

export interface SegmentResult {
  /** The normalised segment text. */
  segment: string;
  /** True if this segment was found. */
  verified: boolean;
  /** View that matched. Null when not found. */
  matchKind: MatchKind | null;
  /** All occurrences of this segment (capped at 50). */
  occurrences: Occurrence[];
  /** Primary occurrence: chunk-preferred, else first. null if not found. */
  primary: Occurrence | null;
}

export interface VerifyResult {
  verified: boolean;
  failReason?: FailReason;
  /** "exact" if any view found it without whitespace removal; "loose" for loose-key match. */
  matchKind?: MatchKind;
  /** All segments (one if no ellipsis). */
  segments: SegmentResult[];
  /** Total occurrence count across all segments. */
  occurrenceCount: number;
  /** Canonical start of primary occurrence for the first segment. */
  canonicalStart?: number;
  /** Canonical end of primary occurrence for the last segment. */
  canonicalEnd?: number;
  /** Page start of first segment primary occurrence. */
  pageStart?: number;
  /** Page end of last segment primary occurrence. */
  pageEnd?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_LEN = 20;
const MAX_LEN = 2000;
const MAX_OCCURRENCES = 50;

// ---------------------------------------------------------------------------
// Page-range helpers
// ---------------------------------------------------------------------------

interface PageRange {
  charStart: number;
  charEnd: number;
  pageNo: number;
}

function charOffsetToPage(offset: number, pages: PageRange[]): number {
  // Binary search for the page containing this offset.
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid];
    if (offset < p.charStart) {
      hi = mid - 1;
    } else if (offset >= p.charEnd) {
      lo = mid + 1;
    } else {
      return p.pageNo;
    }
  }
  // Fallback: clamp to last page
  return pages[pages.length - 1]?.pageNo ?? 1;
}

function occurrenceWithPages(start: number, end: number, pages: PageRange[]): Occurrence {
  return {
    start,
    end,
    pageStart: charOffsetToPage(start, pages),
    pageEnd: charOffsetToPage(Math.max(start, end - 1), pages),
  };
}

// ---------------------------------------------------------------------------
// All-occurrences search (exact, capped at MAX_OCCURRENCES)
// ---------------------------------------------------------------------------

/**
 * Find all non-overlapping occurrences of needle in haystack.
 * The needle and haystack are normalised view strings.
 * The map array maps view positions back to canonical-text positions.
 */
function findAllOccurrences(
  needle: string,
  haystackView: NormView,
  pages: PageRange[]
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const hs = haystackView.s;
  const map = haystackView.map;

  let from = 0;
  while (occurrences.length < MAX_OCCURRENCES) {
    const idx = hs.indexOf(needle, from);
    if (idx === -1) break;

    // Map view positions back to canonical-text positions using the offset map.
    const canonStart = map[idx];
    // End: map[idx + needle.length] gives the canonical position just past the match.
    const canonEnd = map[idx + needle.length];

    occurrences.push(occurrenceWithPages(canonStart, canonEnd, pages));
    from = idx + 1; // allow overlapping (conservative); advance by 1
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Single segment verifier
// ---------------------------------------------------------------------------

async function verifySegment(
  segmentText: string,
  documentId: string,
  canonicalText: string,
  pages: PageRange[],
  chunkStart?: number,
  chunkEnd?: number
): Promise<SegmentResult> {
  const normQ = normalise(segmentText).s;

  // Build document views (cached after first call).
  const views = getViews(documentId, canonicalText);

  // Normalise the quote against each view type.
  const keepQ = keepView(segmentText).s;
  const joinQ = joinView(segmentText).s;
  const looseQ = looseKey(segmentText).s;

  let occurrences: Occurrence[] = [];
  let matchKind: MatchKind | null = null;

  // Primary search: keep view (exact match after standard normalisation)
  const keepOccurrences = findAllOccurrences(keepQ, views.keep, pages);
  if (keepOccurrences.length > 0) {
    occurrences = keepOccurrences;
    matchKind = "exact";
  }

  // Secondary search: join view (de-hyphenated)
  if (matchKind === null) {
    const joinOccurrences = findAllOccurrences(joinQ, views.join, pages);
    if (joinOccurrences.length > 0) {
      occurrences = joinOccurrences;
      matchKind = "exact";
    }
  }

  // Tertiary fallback: loose key (whitespace-free, catches glued/split words)
  if (matchKind === null) {
    const looseOccurrences = findAllOccurrences(looseQ, views.loose, pages);
    if (looseOccurrences.length > 0) {
      occurrences = looseOccurrences;
      matchKind = "loose";
    }
  }

  if (matchKind === null) {
    return {
      segment: normQ,
      verified: false,
      matchKind: null,
      occurrences: [],
      primary: null,
    };
  }

  // Choose primary occurrence: prefer one inside the LLM chunk that produced the quote.
  let primary = occurrences[0]; // default: first in document
  if (chunkStart !== undefined && chunkEnd !== undefined) {
    const inChunk = occurrences.find(
      (o) => o.start >= chunkStart && o.end <= chunkEnd
    );
    if (inChunk) primary = inChunk;
  }

  return {
    segment: normQ,
    verified: true,
    matchKind,
    occurrences,
    primary,
  };
}

// ---------------------------------------------------------------------------
// Main public function
// ---------------------------------------------------------------------------

/**
 * verifyQuote(quoteText, documentId, options?) -> VerifyResult
 *
 * @param quoteText  The exact text the model returned.
 * @param documentId The document the model attributed this quote to (I-7).
 * @param chunkStart Optional canonical start of the chunk this quote came from.
 * @param chunkEnd   Optional canonical end of the chunk this quote came from.
 */
export async function verifyQuote(
  quoteText: string,
  documentId: string,
  chunkStart?: number,
  chunkEnd?: number
): Promise<VerifyResult> {
  // Step 1: normalise quote
  const normQ = normalise(quoteText).s;

  // Step 2: length checks
  if (normQ.length < MIN_LEN) {
    return { verified: false, failReason: "TOO_SHORT", segments: [], occurrenceCount: 0 };
  }
  if (normQ.length > MAX_LEN) {
    return { verified: false, failReason: "TOO_LONG", segments: [], occurrenceCount: 0 };
  }

  // Load document text and page offsets from DB.
  const docText = await db.documentText.findUnique({
    where: { documentId },
    select: { text: true },
  });

  if (!docText) {
    // Document doesn't exist in this DB -> WRONG_DOCUMENT (I-7).
    return { verified: false, failReason: "WRONG_DOCUMENT", segments: [], occurrenceCount: 0 };
  }

  const dbPages = await db.documentPage.findMany({
    where: { documentId },
    select: { pageNo: true, charStart: true, charEnd: true },
    orderBy: { pageNo: "asc" },
  });

  const pages: PageRange[] = dbPages.map((p) => ({
    charStart: p.charStart,
    charEnd: p.charEnd,
    pageNo: p.pageNo,
  }));

  const canonicalText = docText.text;

  // Step 3: ellipsis handling - split into segments
  const rawSegments = splitEllipsis(quoteText);

  const segmentResults: SegmentResult[] = [];
  let totalOccurrences = 0;

  for (const seg of rawSegments) {
    const normSeg = normalise(seg).s;
    if (normSeg.length < MIN_LEN) {
      // Segment too short after normalisation -> entire quote fails.
      return {
        verified: false,
        failReason: "TOO_SHORT",
        segments: [],
        occurrenceCount: 0,
      };
    }

    const result = await verifySegment(seg, documentId, canonicalText, pages, chunkStart, chunkEnd);
    segmentResults.push(result);
    totalOccurrences += result.occurrences.length;

    // All segments must verify (Architecture.md SS7 step 3).
    if (!result.verified) {
      // Before returning NOT_FOUND, check if quote exists in ANY other document.
      // This implements I-7 / WRONG_DOCUMENT detection.
      const otherDocs = await db.documentText.findMany({
        where: { documentId: { not: documentId } },
        select: { documentId: true, text: true },
      });
      for (const otherDoc of otherDocs) {
        const otherViews = getViews(otherDoc.documentId, otherDoc.text);
        const keepQ = keepView(seg).s;
        if (otherViews.keep.s.includes(keepQ)) {
          return { verified: false, failReason: "WRONG_DOCUMENT", segments: segmentResults, occurrenceCount: 0 };
        }
        const joinQ = joinView(seg).s;
        if (otherViews.join.s.includes(joinQ)) {
          return { verified: false, failReason: "WRONG_DOCUMENT", segments: segmentResults, occurrenceCount: 0 };
        }
      }
      return { verified: false, failReason: "NOT_FOUND", segments: segmentResults, occurrenceCount: 0 };
    }
  }

  // All segments verified.
  // Determine overall matchKind: "loose" only if any segment used loose.
  const overallKind: MatchKind =
    segmentResults.some((r) => r.matchKind === "loose") ? "loose" : "exact";

  // Aggregate: use primary occurrences of first and last segment for document range.
  const firstSegPrimary = segmentResults[0].primary!;
  const lastSegPrimary = segmentResults[segmentResults.length - 1].primary!;

  return {
    verified: true,
    matchKind: overallKind,
    segments: segmentResults,
    occurrenceCount: totalOccurrences,
    canonicalStart: firstSegPrimary.start,
    canonicalEnd: lastSegPrimary.end,
    pageStart: firstSegPrimary.pageStart,
    pageEnd: lastSegPrimary.pageEnd,
  };
}
