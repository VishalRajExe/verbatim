/**
 * Target Verification for Tracked Changes Redlining (FR-8, Rules I-10).
 *
 * Invariant I-10:
 * Redline targets are verified to exist in the DOCX text view before an edit is offered.
 *
 * Requirements:
 * - Each target must exist in the DOCX text view.
 * - Each target must resolve to EXACTLY ONE location in the DOCX text view.
 * - Single occurrence: verified directly.
 * - Repeated target: disambiguated using verified surrounding context / clause anchor.
 * - If surrounding context matches multiple locations: drop and ask for more context (never guess).
 * - Never blindly pick the first occurrence.
 * - Never perform fuzzy replacement.
 */

import { clauseContainsValue, extractActualValueInClause } from "./instruction-intent";

export interface RedlineRawEdit {
  target: string;
  replacement: string;
  reason: string;
  contextBefore?: string;
  contextAfter?: string;
  passage?: string; // Authoritative verified passage from Pass 1
  expectedOriginal?: string; // If user instruction specified a starting value (e.g. from AED 500,000)
  actualDocumentValue?: string; // Value actually present in the clause (e.g. AED 100,000)
  targetConcept?: string;
  preFailed?: boolean;
  preFailedReason?: string;
}

export interface RedlineVerifiedEdit {
  id: string;
  target: string;
  replacement: string;
  reason: string;
  verified: boolean;
  include: boolean;
  dropReason?: string;
  occurrences: number;
  matchStartIndex?: number; // Pinned start index in authoritative DOCX text view
  matchEndIndex?: number;
  matchedClause?: string; // Anchor or clause that uniquely resolved the target
  contextBefore?: string;
  contextAfter?: string;
  expectedOriginal?: string;
  actualDocumentValue?: string;
  targetConcept?: string;
}

export interface VerifyEditsResult {
  allEdits: RedlineVerifiedEdit[];
  verifiedEdits: RedlineVerifiedEdit[];
  droppedEdits: RedlineVerifiedEdit[];
}

/**
 * Finds all non-overlapping start indices of target substring inside source text.
 */
export function findAllExactOccurrences(source: string, target: string): number[] {
  if (!target || target.length === 0) return [];
  const indices: number[] = [];
  let pos = 0;
  while ((pos = source.indexOf(target, pos)) !== -1) {
    indices.push(pos);
    pos += target.length;
  }
  return indices;
}

/**
 * Counts non-overlapping occurrences of target substring inside source text.
 */
export function countExactOccurrences(source: string, target: string): number {
  return findAllExactOccurrences(source, target).length;
}

interface AnchoredResolution {
  resolved: boolean;
  matchStartIndex?: number;
  matchedClause?: string;
  dropReason?: string;
  occurrences: number;
}

/**
 * Attempts to resolve an ambiguous repeated target to exactly one location
 * using verified surrounding clause context (Anchored Exact Matching).
 */
export function resolveAnchoredTarget(
  docxTextView: string,
  target: string,
  bareIndices: number[],
  raw: RedlineRawEdit
): AnchoredResolution {
  const bareCount = bareIndices.length;

  // 1. Try Candidate Anchor from Pass 1 Verified Passage
  if (raw.passage && raw.passage.includes(target)) {
    const passageMatches = findAllExactOccurrences(docxTextView, raw.passage);
    if (passageMatches.length === 1) {
      const targetOffset = passageMatches[0] + raw.passage.indexOf(target);
      if (bareIndices.includes(targetOffset)) {
        return {
          resolved: true,
          matchStartIndex: targetOffset,
          matchedClause: raw.passage,
          occurrences: 1,
        };
      }
    } else if (passageMatches.length > 1) {
      // The entire passage is duplicated across multiple clauses (e.g. Test B)
      return {
        resolved: false,
        dropReason: `Target text is ambiguous (appears ${bareCount} times in document, and surrounding clause appears ${passageMatches.length} times). Please specify more surrounding context to isolate the exact clause.`,
        occurrences: passageMatches.length,
      };
    }
  }

  // 2. Try Surrounding Context (contextBefore and/or contextAfter)
  const ctxBefore = (raw.contextBefore || "").trim();
  const ctxAfter = (raw.contextAfter || "").trim();

  const anchorsToTry: Array<{ anchor: string; targetOffsetInAnchor: number }> = [];

  if (ctxBefore && ctxAfter) {
    // Full anchor: [before][target][after]
    // Allow for potential whitespace variation
    const fullAnchor = `${ctxBefore}${raw.contextBefore?.endsWith(" ") ? " " : ""}${target}${raw.contextAfter?.startsWith(" ") ? " " : ""}${ctxAfter}`;
    const offset = fullAnchor.indexOf(target);
    if (offset !== -1) {
      anchorsToTry.push({ anchor: fullAnchor, targetOffsetInAnchor: offset });
    }
  }

  if (ctxBefore) {
    const beforeAnchor = `${ctxBefore}${raw.contextBefore?.endsWith(" ") ? " " : ""}${target}`;
    const offset = beforeAnchor.lastIndexOf(target);
    if (offset !== -1) {
      anchorsToTry.push({ anchor: beforeAnchor, targetOffsetInAnchor: offset });
    }
  }

  if (ctxAfter) {
    const afterAnchor = `${target}${raw.contextAfter?.startsWith(" ") ? " " : ""}${ctxAfter}`;
    const offset = afterAnchor.indexOf(target);
    if (offset !== -1) {
      anchorsToTry.push({ anchor: afterAnchor, targetOffsetInAnchor: offset });
    }
  }

  let multipleMatchesCount = 0;

  for (const { anchor, targetOffsetInAnchor } of anchorsToTry) {
    const matches = findAllExactOccurrences(docxTextView, anchor);
    if (matches.length === 1) {
      const targetStart = matches[0] + targetOffsetInAnchor;
      if (bareIndices.includes(targetStart)) {
        return {
          resolved: true,
          matchStartIndex: targetStart,
          matchedClause: anchor,
          occurrences: 1,
        };
      }
    } else if (matches.length > 1) {
      multipleMatchesCount = Math.max(multipleMatchesCount, matches.length);
    }
  }

  // If surrounding context still matches multiple locations: DO NOT GUESS.
  if (multipleMatchesCount > 1) {
    return {
      resolved: false,
      dropReason: `Target text is ambiguous (appears ${bareCount} times in document, and surrounding context matches ${multipleMatchesCount} locations). Please specify more surrounding context to isolate the exact clause.`,
      occurrences: multipleMatchesCount,
    };
  }

  // No anchor uniquely identified the location
  return {
    resolved: false,
    dropReason: `Target text is ambiguous (appears ${bareCount} times in the document). Please specify more surrounding context to isolate the exact clause.`,
    occurrences: bareCount,
  };
}

/**
 * Verifies a list of raw proposed edits against the authoritative DOCX text view.
 */
export function verifyEdits(
  rawEdits: RedlineRawEdit[],
  docxTextView: string
): VerifyEditsResult {
  const allEdits: RedlineVerifiedEdit[] = [];
  const verifiedEdits: RedlineVerifiedEdit[] = [];
  const droppedEdits: RedlineVerifiedEdit[] = [];

  rawEdits.forEach((raw, idx) => {
    const id = `edit-${idx + 1}-${Date.now().toString(36)}`;
    const target = raw.target ?? "";
    const replacement = raw.replacement ?? "";
    const reason = raw.reason ?? "";

    // 0. Precondition check: If an expectedOriginal value was specified by the user,
    // verify that:
    // (a) It was not pre-failed
    // (b) If passage is provided, passage contains expectedOriginal
    // (c) Target matches expectedOriginal (server NEVER silently substitutes another value)
    const hasMismatchedTarget = Boolean(
      raw.expectedOriginal && !clauseContainsValue(target, raw.expectedOriginal)
    );
    const hasMismatchedPassage = Boolean(
      raw.expectedOriginal && raw.passage && !clauseContainsValue(raw.passage, raw.expectedOriginal)
    );

    if (raw.preFailed || hasMismatchedTarget || hasMismatchedPassage) {
      const actualVal =
        raw.actualDocumentValue ||
        (raw.passage ? extractActualValueInClause(raw.passage, raw.expectedOriginal || "") : undefined) ||
        (hasMismatchedTarget ? target : undefined) ||
        "a different value";
      const dropReason =
        raw.preFailedReason ||
        `The specified original value ${raw.expectedOriginal} was not found in the identified clause. The document contains ${actualVal} instead. No change was applied.`;

      const edit: RedlineVerifiedEdit = {
        id,
        target: raw.expectedOriginal || target,
        expectedOriginal: raw.expectedOriginal,
        actualDocumentValue: actualVal,
        targetConcept: raw.targetConcept,
        replacement,
        reason,
        verified: false,
        include: false,
        dropReason,
        occurrences: 0,
        contextBefore: raw.contextBefore,
        contextAfter: raw.contextAfter,
      };
      allEdits.push(edit);
      droppedEdits.push(edit);
      console.warn(`[Redline Verify] PRECONDITION FAILED: ${dropReason}`);
      return;
    }

    if (!target.trim()) {
      const edit: RedlineVerifiedEdit = {
        id,
        target,
        replacement,
        reason,
        verified: false,
        include: false,
        dropReason: "Target text is empty.",
        occurrences: 0,
      };
      allEdits.push(edit);
      droppedEdits.push(edit);
      return;
    }

    if (target === replacement) {
      const edit: RedlineVerifiedEdit = {
        id,
        target,
        replacement,
        reason,
        verified: false,
        include: false,
        dropReason: "Target and replacement are identical; no revision required.",
        occurrences: countExactOccurrences(docxTextView, target),
      };
      allEdits.push(edit);
      droppedEdits.push(edit);
      return;
    }

    const bareIndices = findAllExactOccurrences(docxTextView, target);
    const bareCount = bareIndices.length;

    if (bareCount === 0) {
      const edit: RedlineVerifiedEdit = {
        id,
        target,
        replacement,
        reason,
        verified: false,
        include: false,
        dropReason:
          "Target text was not found in the document. Edits cannot be safely applied.",
        occurrences: 0,
        expectedOriginal: raw.expectedOriginal,
        actualDocumentValue: raw.actualDocumentValue,
        targetConcept: raw.targetConcept,
      };
      allEdits.push(edit);
      droppedEdits.push(edit);
      console.warn(`[Redline Verify] Target: "${target}" - NOT FOUND (0 occurrences)`);
      return;
    }

    if (bareCount === 1) {
      // Exactly one occurrence globally - verified directly!
      const matchStartIndex = bareIndices[0];
      const edit: RedlineVerifiedEdit = {
        id,
        target,
        replacement,
        reason,
        verified: true,
        include: true,
        occurrences: 1,
        matchStartIndex,
        matchEndIndex: matchStartIndex + target.length,
        contextBefore: raw.contextBefore,
        contextAfter: raw.contextAfter,
        expectedOriginal: raw.expectedOriginal,
        actualDocumentValue: target,
        targetConcept: raw.targetConcept,
      };
      allEdits.push(edit);
      verifiedEdits.push(edit);
      console.log(`[Redline Verify] Target: "${target}" - VERIFIED (unique occurrence at index ${matchStartIndex})`);
      return;
    }

    // bareCount > 1: Repeated value! Use Anchored Exact Matching.
    const resolution = resolveAnchoredTarget(docxTextView, target, bareIndices, raw);

    if (resolution.resolved && resolution.matchStartIndex !== undefined) {
      const matchStartIndex = resolution.matchStartIndex;
      const edit: RedlineVerifiedEdit = {
        id,
        target,
        replacement,
        reason,
        verified: true,
        include: true,
        occurrences: 1, // Disambiguated to exactly 1 intended occurrence!
        matchStartIndex,
        matchEndIndex: matchStartIndex + target.length,
        matchedClause: resolution.matchedClause,
        contextBefore: raw.contextBefore,
        contextAfter: raw.contextAfter,
        expectedOriginal: raw.expectedOriginal,
        actualDocumentValue: target,
        targetConcept: raw.targetConcept,
      };
      allEdits.push(edit);
      verifiedEdits.push(edit);
      console.log(`[Redline Verify] Repeated target "${target}" (${bareCount} occurrences in doc) - DISAMBIGUATED to index ${matchStartIndex} via anchor`);
    } else {
      // Ambiguity remains: Drop honestly (never guess, Rule I-10)
      const edit: RedlineVerifiedEdit = {
        id,
        target,
        replacement,
        reason,
        verified: false,
        include: false,
        dropReason: resolution.dropReason,
        occurrences: resolution.occurrences,
        expectedOriginal: raw.expectedOriginal,
        actualDocumentValue: raw.actualDocumentValue,
        targetConcept: raw.targetConcept,
      };
      allEdits.push(edit);
      droppedEdits.push(edit);
      console.warn(`[Redline Verify] Repeated target "${target}" - DROPPED: ${resolution.dropReason}`);
    }
  });

  return {
    allEdits,
    verifiedEdits,
    droppedEdits,
  };
}
