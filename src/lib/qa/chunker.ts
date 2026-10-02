/**
 * Document chunker for large legal contracts (PRD FR-4, Architecture §8).
 *
 * Rules:
 * - Uses CHUNK_TOKENS (default ~24,000 tokens ≈ 96,000 characters).
 * - Splits at paragraph (\n\n) or heading/line (\n) boundaries.
 * - Small overlap between successive chunks so clauses spanning chunk boundaries
 *   are not cut in half without context.
 * - No source text is lost: union of all [charStart, charEnd) covers [0, text.length).
 * - Canonical ranges identify exact overlap regions.
 * - Short documents (< CHUNK_TOKENS) remain a single chunk.
 * - Every chunk stays within the token budget.
 */
import { env } from "@/lib/env";

/** Approximate tokens from character count (1 token ≈ 4 chars for English/code). */
export function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export interface Chunk {
  /** 0-based index within the document's chunk array. */
  index: number;
  /** Total number of chunks for this document. */
  total: number;
  /** Text content of the chunk, exactly equal to canonicalText.slice(charStart, charEnd). */
  text: string;
  /** Start offset in canonical document text (inclusive). */
  charStart: number;
  /** End offset in canonical document text (exclusive). */
  charEnd: number;
}

export interface ChunkerOptions {
  /** Max tokens per chunk. Defaults to env.CHUNK_TOKENS (24000). */
  maxTokens?: number;
  /** Desired overlap tokens between chunks. Defaults to ~5% of maxTokens. */
  overlapTokens?: number;
}

/**
 * Split canonical document text into overlapping chunks respecting paragraph
 * and heading boundaries.
 */
export function chunkDocument(
  canonicalText: string,
  options?: ChunkerOptions
): Chunk[] {
  const maxTokens = options?.maxTokens ?? env.CHUNK_TOKENS;
  const maxChars = maxTokens * 4;

  if (canonicalText.length === 0) {
    return [];
  }

  // Short document: fits in one chunk without splitting.
  if (canonicalText.length <= maxChars) {
    return [
      {
        index: 0,
        total: 1,
        text: canonicalText,
        charStart: 0,
        charEnd: canonicalText.length,
      },
    ];
  }

  // Overlap: default to ~5% of maxChars, capped between 200 and 4000 chars.
  const defaultOverlapChars = Math.min(
    Math.max(Math.round(maxChars * 0.05), 200),
    4000
  );
  const overlapChars = options?.overlapTokens !== undefined
    ? options.overlapTokens * 4
    : defaultOverlapChars;

  const chunks: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let start = 0;

  while (start < canonicalText.length) {
    const remaining = canonicalText.length - start;

    // If remaining text fits comfortably within maxChars, take it all.
    if (remaining <= maxChars) {
      chunks.push({
        text: canonicalText.slice(start),
        charStart: start,
        charEnd: canonicalText.length,
      });
      break;
    }

    // Target hard ceiling
    const hardEnd = start + maxChars;
    // Search window for boundaries: between start + maxChars * 0.6 and hardEnd
    const minBreak = start + Math.floor(maxChars * 0.6);

    let splitIndex = -1;

    // 1. Try paragraph boundary: \n\n
    const searchSlice = canonicalText.slice(minBreak, hardEnd);
    const lastPara = searchSlice.lastIndexOf("\n\n");
    if (lastPara !== -1) {
      // Split right after the paragraph break
      splitIndex = minBreak + lastPara + 2;
    }

    // 2. Try newline boundary: \n
    if (splitIndex === -1) {
      const lastNewline = searchSlice.lastIndexOf("\n");
      if (lastNewline !== -1) {
        splitIndex = minBreak + lastNewline + 1;
      }
    }

    // 3. Try sentence boundary: period/question/exclamation followed by whitespace
    if (splitIndex === -1) {
      const sentenceMatch = searchSlice.match(/[.!?]\s+(?=[^.!?]*$)/);
      if (sentenceMatch && sentenceMatch.index !== undefined) {
        splitIndex = minBreak + sentenceMatch.index + 1;
      }
    }

    // 4. Try whitespace boundary: space
    if (splitIndex === -1) {
      const lastSpace = searchSlice.lastIndexOf(" ");
      if (lastSpace !== -1) {
        splitIndex = minBreak + lastSpace + 1;
      }
    }

    // 5. Fallback: hard cut at maxChars
    if (splitIndex === -1 || splitIndex <= start) {
      splitIndex = hardEnd;
    }

    const end = Math.min(splitIndex, canonicalText.length);
    chunks.push({
      text: canonicalText.slice(start, end),
      charStart: start,
      charEnd: end,
    });

    if (end >= canonicalText.length) {
      break;
    }

    // Compute next start with overlap
    let nextStart = Math.max(start + 1, end - overlapChars);

    // Try to snap nextStart forward to a paragraph or sentence boundary
    // within the overlap window to avoid beginning mid-word or mid-sentence.
    const overlapWindow = canonicalText.slice(nextStart, end);
    const paraInOverlap = overlapWindow.indexOf("\n\n");
    if (paraInOverlap !== -1 && nextStart + paraInOverlap + 2 < end) {
      nextStart = nextStart + paraInOverlap + 2;
    } else {
      const newlineInOverlap = overlapWindow.indexOf("\n");
      if (newlineInOverlap !== -1 && nextStart + newlineInOverlap + 1 < end) {
        nextStart = nextStart + newlineInOverlap + 1;
      }
    }

    // Safety: ensure progress is always made
    if (nextStart <= start) {
      nextStart = start + Math.max(1, Math.floor(maxChars * 0.5));
    }

    start = nextStart;
  }

  const total = chunks.length;
  return chunks.map((c, index) => ({
    index,
    total,
    text: c.text,
    charStart: c.charStart,
    charEnd: c.charEnd,
  }));
}
