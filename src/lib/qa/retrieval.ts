/**
 * Generic Retrieval & Section Selection for Legal Contracts.
 *
 * Implements generic multi-pass concept retrieval, query expansion,
 * and section ranking without hardcoding any specific documents,
 * questions, filenames, page numbers, or answers.
 *
 * Pipeline step:
 *   Question
 *   -> Extract substantive concepts (phrases, terms, entities)
 *   -> Rank document chunks by concept coverage, phrase matches, and density
 *   -> Select relevant chunks (including cross-section / boundary context)
 *   -> Read selected chunks with rate-pacing to avoid LLM rate limits
 */

import type { Chunk } from "./chunker";

/** Common English conversational stop words to exclude from keyword scoring */
const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "her", "here", "hers", "herself",
  "him", "himself", "his", "how", "i", "if", "in", "into", "is", "isn't", "it",
  "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself", "no",
  "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "say", "saying", "says",
  "she", "should", "shouldn't", "so", "some", "such", "than", "that", "the",
  "their", "theirs", "them", "themselves", "then", "there", "these", "they",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "wasn't", "we", "were", "weren't", "what", "when", "where", "which", "while",
  "who", "whom", "why", "with", "won't", "would", "wouldn't", "you", "your",
  "yours", "yourself", "yourselves", "tell", "state", "states", "stated", "describe",
  "explain", "show", "showing", "give", "much", "many"
]);

export interface QueryConcepts {
  /** Individual substantive root terms (lowercased) */
  terms: string[];
  /** Multi-word phrases / n-grams extracted from question */
  phrases: string[];
  /** Numerical / entity tokens (e.g. "page 87", "100,000", "30 days") */
  entityTokens: string[];
}

/**
 * Extracts substantive concepts and search phrases from any natural-language question.
 */
export function extractQueryConcepts(question: string): QueryConcepts {
  const normalized = question.toLowerCase();

  // 1. Extract potential entity tokens (e.g. "page 87", "section 4", numbers, amounts)
  const entityTokens: string[] = [];
  const entityMatches = normalized.match(/(?:page\s+\d+|section\s+[\d.]+|article\s+[\d.]+|\b\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:days?|months?|years?|percent|%|aed|usd|eur|gbp))?\b)/gi);
  if (entityMatches) {
    for (const match of entityMatches) {
      const trimmed = match.trim();
      if (trimmed.length > 1 && !entityTokens.includes(trimmed)) {
        entityTokens.push(trimmed);
      }
    }
  }

  // 2. Extract multi-word phrases by splitting on punctuation and conjunctions
  const phrases: string[] = [];
  const clauseSegments = normalized
    .replace(/[?.,;:!"()[\]{}]/g, " ")
    .split(/\s+(?:and|or|with|about|regarding|in relation to|concerning)\s+/i);

  for (const segment of clauseSegments) {
    const words = segment.trim().split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
    for (let i = 0; i < words.length - 1; i++) {
      const biGram = `${words[i]} ${words[i + 1]}`;
      if (!phrases.includes(biGram)) phrases.push(biGram);
      if (i < words.length - 2) {
        const triGram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        if (!phrases.includes(triGram)) phrases.push(triGram);
      }
    }
  }

  // Also include hyphenated combinations (e.g. "incident-report" -> "incident report")
  const hyphenMatches = question.match(/\b\w+-\w+\b/g);
  if (hyphenMatches) {
    for (const hm of hyphenMatches) {
      const spaceVersion = hm.replace("-", " ").toLowerCase();
      if (!phrases.includes(spaceVersion)) {
        phrases.push(spaceVersion);
      }
    }
  }

  // 3. Extract individual substantive terms
  const rawWords = normalized
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/);

  const termSet = new Set<string>();
  for (const word of rawWords) {
    const clean = word.replace(/^-+|-+$/g, "");
    if (clean.length > 2 && !STOP_WORDS.has(clean)) {
      termSet.add(clean);
      // If word contains hyphen, also add parts
      if (clean.includes("-")) {
        for (const part of clean.split("-")) {
          if (part.length > 2 && !STOP_WORDS.has(part)) {
            termSet.add(part);
          }
        }
      }
    }
  }

  return {
    terms: Array.from(termSet),
    phrases,
    entityTokens,
  };
}

export interface ChunkScore {
  chunk: Chunk;
  score: number;
  matchedConcepts: string[];
  matchedPhrases: string[];
  termHits: number;
}

/**
 * Evaluates the relevance of a chunk against extracted query concepts.
 */
export function scoreChunk(chunk: Chunk, concepts: QueryConcepts): ChunkScore {
  const textLower = chunk.text.toLowerCase();
  let score = 0;
  const matchedConcepts: string[] = [];
  const matchedPhrases: string[] = [];
  let termHits = 0;

  // 1. Entity tokens (very high precision, e.g. "page 87", "section 4")
  for (const entity of concepts.entityTokens) {
    if (textLower.includes(entity)) {
      score += 15;
      matchedConcepts.push(entity);
    }
  }

  // 2. Multi-word phrase matches (e.g. "incident report", "liability cap")
  for (const phrase of concepts.phrases) {
    if (textLower.includes(phrase)) {
      score += 12;
      matchedPhrases.push(phrase);
      matchedConcepts.push(phrase);
    }
  }

  // 3. Substantive term coverage & frequency
  for (const term of concepts.terms) {
    // Check if term exists in chunk
    const idx = textLower.indexOf(term);
    if (idx !== -1) {
      // First hit rewards concept diversity
      score += 3;
      matchedConcepts.push(term);

      // Count term occurrences (up to 5 for frequency weight)
      let count = 0;
      let pos = idx;
      while (pos !== -1 && count < 5) {
        count++;
        pos = textLower.indexOf(term, pos + term.length + 1);
      }
      termHits += count;
      score += Math.min(count, 5) * 0.5;
    }
  }

  // Concept diversity bonus: if a chunk matches a high proportion of query terms,
  // it is far more likely to be the core section addressing the multi-concept question.
  if (concepts.terms.length > 0) {
    const coverageRatio = matchedConcepts.length / concepts.terms.length;
    if (coverageRatio >= 0.6) {
      score += 10;
    }
    if (coverageRatio >= 0.8) {
      score += 15;
    }
  }

  return {
    chunk,
    score,
    matchedConcepts,
    matchedPhrases,
    termHits,
  };
}

export interface RetrievalResult {
  selectedChunks: Chunk[];
  allScores: ChunkScore[];
  isSelective: boolean;
  totalChunks: number;
}

/**
 * Generic section selection for a document given a natural language query.
 *
 * - If document has only 1 chunk, selects it directly (full coverage).
 * - If document has multiple chunks, selects the most relevant chunks based on
 *   concept coverage, phrase matches, and surrounding boundary context.
 * - Guarantees that multi-section / cross-page clauses are preserved by expanding
 *   adjacent chunks when matches occur near boundary zones.
 */
export function selectRelevantChunks(
  chunks: Chunk[],
  question: string,
  options?: {
    maxChunksToRead?: number;
    scoreThreshold?: number;
  }
): RetrievalResult {
  if (chunks.length === 0) {
    return { selectedChunks: [], allScores: [], isSelective: false, totalChunks: 0 };
  }

  // Single chunk document: read completely
  if (chunks.length === 1) {
    return {
      selectedChunks: [chunks[0]],
      allScores: [{ chunk: chunks[0], score: 10, matchedConcepts: [], matchedPhrases: [], termHits: 1 }],
      isSelective: false,
      totalChunks: 1,
    };
  }

  const maxChunks = options?.maxChunksToRead ?? 2;
  const concepts = extractQueryConcepts(question);
  const scored = chunks.map(chunk => scoreChunk(chunk, concepts));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const highestScore = scored[0]?.score ?? 0;

  // If no chunks matched any query concepts (e.g. pure negative or exploratory question),
  // select chunk 0 as initial representative chunk to verify absence or read up to maxChunks.
  if (highestScore <= 0) {
    return {
      selectedChunks: chunks.slice(0, Math.min(chunks.length, maxChunks)),
      allScores: scored,
      isSelective: true,
      totalChunks: chunks.length,
    };
  }

  const selectedIndices = new Set<number>();

  // Add the highest scoring chunk
  selectedIndices.add(scored[0].chunk.index);

  // Add secondary chunks if their score is significant (at least 30% of highest score and > 3)
  for (let i = 1; i < scored.length; i++) {
    if (selectedIndices.size >= maxChunks) break;
    const sc = scored[i];
    if (sc.score >= 3 && sc.score >= highestScore * 0.3) {
      selectedIndices.add(sc.chunk.index);
    }
  }

  // Boundary expansion: If a selected chunk has matches near its beginning or end,
  // include the immediately adjacent chunk to prevent cutting cross-boundary clauses.
  for (const idx of Array.from(selectedIndices)) {
    const chunk = chunks.find(c => c.index === idx);
    if (!chunk) continue;
    const textLower = chunk.text.toLowerCase();
    const boundaryThreshold = Math.floor(chunk.text.length * 0.08); // 8% of chunk size

    for (const term of concepts.terms) {
      const firstIdx = textLower.indexOf(term);
      if (firstIdx !== -1 && firstIdx < boundaryThreshold && idx > 0) {
        // Match near start of chunk -> expand to previous chunk if within budget
        if (selectedIndices.size < maxChunks + 1) {
          selectedIndices.add(idx - 1);
        }
      }

      const lastIdx = textLower.lastIndexOf(term);
      if (lastIdx !== -1 && lastIdx > chunk.text.length - boundaryThreshold && idx < chunks.length - 1) {
        // Match near end of chunk -> expand to next chunk if within budget
        if (selectedIndices.size < maxChunks + 1) {
          selectedIndices.add(idx + 1);
        }
      }
    }
  }

  // Order selected chunks by original index order
  const finalChunks = chunks
    .filter(c => selectedIndices.has(c.index))
    .sort((a, b) => a.index - b.index);

  return {
    selectedChunks: finalChunks,
    allScores: scored,
    isSelective: finalChunks.length < chunks.length,
    totalChunks: chunks.length,
  };
}
