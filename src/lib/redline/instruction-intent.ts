/**
 * Instruction Intent & Value Extraction for Tracked Changes Redlining.
 *
 * Implements deterministic server-side extraction and normalization
 * to ensure that for explicit "from X to Y" instructions, X is strictly
 * verified to exist in the authoritative target clause before proposing edits.
 */

export interface ExtractedIntent {
  expectedOriginal?: string;
  replacement: string;
  targetConcept?: string;
  rawClause?: string;
}

/**
 * Normalizes text for exact deterministic matching without altering numerical meaning.
 * Handles:
 * - whitespace normalization (multiple spaces -> single space)
 * - non-breaking spaces (\u00A0) and zero-width characters
 * - Unicode quotes and dashes
 * - trims leading/trailing whitespace
 */
export function normalizeValueForMatch(val: string): string {
  if (!val) return "";
  return val
    .replace(/[\u00A0\u200B\u200E\u200F\uFEFF]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a clause contains the user's expected original value.
 * Uses deterministic normalized exact matching.
 * Handles variations like commas in numbers (500,000 vs 500000),
 * but NEVER equates different numerical amounts (e.g. 500,000 != 100,000).
 */
export function clauseContainsValue(clause: string, expectedOriginal: string): boolean {
  if (!clause || !expectedOriginal) return false;

  const normClause = normalizeValueForMatch(clause);
  const normExpected = normalizeValueForMatch(expectedOriginal);

  if (normClause.includes(normExpected)) {
    return true;
  }

  // Also check with comma normalization in numbers (e.g. 500,000 <-> 500000)
  const stripCommas = (s: string) => s.replace(/(\d),(\d)/g, "$1$2");
  if (stripCommas(normClause).includes(stripCommas(normExpected))) {
    return true;
  }

  return false;
}

/**
 * Extracts what value the clause actually contains when the expectedOriginal does not match.
 * For example: if expectedOriginal is "AED 500,000", looks for currency/amount patterns
 * like "AED 100,000" in the clause.
 */
export function extractActualValueInClause(
  clause: string,
  expectedOriginal: string
): string | undefined {
  if (!clause) return undefined;
  const normClause = normalizeValueForMatch(clause);

  // If expected is a currency amount (e.g., "AED 500,000", "$100,000", "€50,000")
  const currencyMatch = expectedOriginal.match(
    /\b(AED|USD|EUR|GBP|\$|€|£)\s*([\d,]+(?:\.\d+)?)/i
  );
  if (currencyMatch) {
    const symbol = currencyMatch[1];
    const pattern = new RegExp(
      `(?:${symbol}\\s*[\\d,]+(?:\\.\\d+)?|[\\d,]+(?:\\.\\d+)?\\s*${symbol})`,
      "gi"
    );
    const matches = Array.from(normClause.matchAll(pattern));
    if (matches.length > 0) {
      return matches[0][0].trim();
    }
  }

  // If expected is a time period (e.g., "30 days", "60 business days", "2 years")
  const timeMatch = expectedOriginal.match(
    /\b(\d+)\s*(days?|business days?|calendar days?|weeks?|months?|years?|hours?)\b/i
  );
  if (timeMatch) {
    const unit = timeMatch[2];
    const pattern = new RegExp(
      `\\b\\d+\\s*(?:business |calendar )?${unit}\\b`,
      "gi"
    );
    const matches = Array.from(normClause.matchAll(pattern));
    if (matches.length > 0) {
      return matches[0][0].trim();
    }
  }

  // Generic number with unit or plain number
  const numMatch = expectedOriginal.match(/\b[\d,]+(?:\.\d+)?\b/);
  if (numMatch) {
    const pattern = /\b[\d,]+(?:\.\d+)?\b/g;
    const matches = Array.from(normClause.matchAll(pattern));
    if (matches.length > 0) {
      return matches[0][0].trim();
    }
  }

  return undefined;
}

/**
 * Deterministically parses natural-language instructions to identify
 * explicit "from X to Y" / "replace X with Y" requirements.
 */
export function parseInstructionIntents(instruction: string): ExtractedIntent[] {
  const intents: ExtractedIntent[] = [];
  if (!instruction) return intents;

  const normalized = normalizeValueForMatch(instruction);

  // Split multi-instruction sentences separated by "and", semicolons, or periods
  const segments = normalized.split(/\s+and\s+|;|\.\s+/i).map((s) => s.trim()).filter(Boolean);

  for (const seg of segments) {
    // Extract targetConcept if present before from/to/replace
    let conceptCandidate: string | undefined;

    // Pattern 1: "... from <X> to <Y> ..."
    // e.g., "Change the liability cap from AED 500,000 to AED 2,000,000"
    const fromToRegex =
      /\bfrom\s+([A-Za-z0-9,.$€£¥\s]+?)\s+to\s+([A-Za-z0-9,.$€£¥\s]+?)(?:(?:\s+(?:in|under|per|for|as)\s+[a-z])|(?<!\d)[.,;]|[;]|$)/i;
    const fromToMatch = seg.match(fromToRegex);

    if (fromToMatch) {
      const expectedOriginal = cleanCapturedValue(fromToMatch[1]);
      const replacement = cleanCapturedValue(fromToMatch[2]);
      if (expectedOriginal && replacement) {
        const preMatch = seg.substring(0, fromToMatch.index).trim();
        const cleanedConcept = preMatch.replace(/^(?:change|update|set|modify|increase|decrease|make)\s+(?:the\s+)?/i, "").trim();
        intents.push({
          expectedOriginal,
          replacement,
          targetConcept: cleanedConcept || undefined,
          rawClause: seg,
        });
        continue;
      }
    }

    // Pattern 2: "replace <X> with <Y>"
    const replaceWithRegex =
      /\breplace\s+([A-Za-z0-9,.$€£¥\s]+?)\s+with\s+([A-Za-z0-9,.$€£¥\s]+?)(?:(?:\s+(?:in|under|per|for|as)\s+[a-z])|(?<!\d)[.,;]|[;]|$)/i;
    const replaceWithMatch = seg.match(replaceWithRegex);

    if (replaceWithMatch) {
      const expectedOriginal = cleanCapturedValue(replaceWithMatch[1]);
      const replacement = cleanCapturedValue(replaceWithMatch[2]);
      if (expectedOriginal && replacement) {
        intents.push({
          expectedOriginal,
          replacement,
          rawClause: seg,
        });
        continue;
      }
    }

    // Pattern 3: "change <X> to <Y>" where X is not a clause concept like "the liability cap"
    // e.g. "change AED 100,000 to AED 1,000,000"
    const changeToRegex =
      /\bchange\s+([A-Za-z0-9,.$€£¥\s]+?)\s+to\s+([A-Za-z0-9,.$€£¥\s]+?)(?:(?:\s+(?:in|under|per|for|as)\s+[a-z])|(?<!\d)[.,;]|[;]|$)/i;
    const changeToMatch = seg.match(changeToRegex);

    if (changeToMatch) {
      const cand = cleanCapturedValue(changeToMatch[1]);
      const replacement = cleanCapturedValue(changeToMatch[2]);
      // Only treat cand as expectedOriginal if it contains a value (digits, currency, days)
      if (cand && replacement && /[\d$€£¥]/.test(cand) && !/liability|payment|clause|term|cap|section/i.test(cand)) {
        intents.push({
          expectedOriginal: cand,
          replacement,
          rawClause: seg,
        });
        continue;
      }
    }

    // Pattern 4: Only replacement specified (e.g., "Change the liability cap to AED 2,000,000")
    // In this case, expectedOriginal is explicitly undefined.
    const onlyToRegex = /\b(?:to|make it|set it to)\s+([A-Za-z0-9,.$€£¥\s]+?)(?:(?:\s+(?:in|under|per|for|as)\s+[a-z])|(?<!\d)[.,;]|[;]|$)/i;
    const onlyToMatch = seg.match(onlyToRegex);
    if (onlyToMatch) {
      const replacement = cleanCapturedValue(onlyToMatch[1]);
      if (replacement) {
        const preMatch = seg.substring(0, onlyToMatch.index).trim();
        const cleanedConcept = preMatch.replace(/^(?:change|update|set|modify|increase|decrease|make)\s+(?:the\s+)?/i, "").trim();
        intents.push({
          expectedOriginal: undefined,
          replacement,
          targetConcept: cleanedConcept || undefined,
          rawClause: seg,
        });
      }
    }
  }

  return intents;
}

function cleanCapturedValue(val: string): string {
  if (!val) return "";
  return val
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/(?<!\d)[.,;]+$/, "")
    .replace(/[.,;]+$/, "")
    .trim();
}
