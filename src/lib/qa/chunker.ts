/**
 * Document chunker.
 *
 * Phase 3: for short documents (< CHUNK_TOKENS), returns a single chunk.
 * Phase 4 will add proper splitting on paragraph boundaries with overlap.
 *
 * A chunk carries its character range within the canonical text so that
 * verifyQuote() can prefer occurrences inside the chunk (Architecture §7 §8).
 */
import { env } from "@/lib/env";

/** Approximate tokens from character count (1 token ≈ 4 chars for English). */
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export interface Chunk {
  /** 0-based index within the document's chunk array. */
  index: number;
  /** Total number of chunks for this document. */
  total: number;
  /** Text content of the chunk. */
  text: string;
  /** Start offset in canonical document text. */
  charStart: number;
  /** End offset (exclusive) in canonical document text. */
  charEnd: number;
}

/**
 * Split canonical document text into chunks.
 *
 * Phase 3: single chunk if below CHUNK_TOKENS budget.
 * (Phase 4 extends this with proper paragraph-boundary splitting.)
 */
export function chunkDocument(canonicalText: string): Chunk[] {
  const budget = env.CHUNK_TOKENS;

  // Phase 3: if the whole text fits in one chunk, return it directly.
  if (charsToTokens(canonicalText.length) <= budget) {
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

  // Phase 3 fallback: still one chunk but truncated to budget * 4 chars.
  // Phase 4 will replace this with proper splitting.
  const maxChars = budget * 4;
  return [
    {
      index: 0,
      total: 1,
      text: canonicalText.slice(0, maxChars),
      charStart: 0,
      charEnd: Math.min(maxChars, canonicalText.length),
    },
  ];
}
