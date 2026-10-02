/**
 * Clause splitting module for document comparison (FR-7).
 *
 * Segments canonical text into clause units by detecting:
 * - Numbered sections (1., 1.1, 4.2.1, 1), (1))
 * - Lettered clauses ((a), a., a))
 * - Labeled headings (Article 1, Section 2, Clause 3)
 * - Standalone headings (ALL-CAPS or Title-Cased)
 * - Paragraph / blank-line fallbacks when headings are absent
 *
 * Preserves exact canonical text start/end offsets for viewer locate.
 */

export interface ClauseUnit {
  id: string;
  order: number;
  number: string | null;
  heading: string | null;
  text: string;
  start: number;
  end: number;
}

export interface SplitResult {
  clauses: ClauseUnit[];
  confidence: number;
  hasUncertainty: boolean;
  reason?: string;
}

// Regex patterns for detecting clause starts
const NUMBERED_REGEX = /^(?:\((\d+(?:\.\d+)*)\)|(\d+(?:\.\d+)*)[.)]?)\s+(\S.*)$/;
const LETTERED_REGEX = /^(?:\(([A-Za-z])\)|([A-Za-z])[.)])\s+(\S.*)$/;
const LABELED_REGEX = /^(?:Section|Article|Clause)\s+(\d+|[IVXLCivxlc]+|[A-Za-z]+)[.:)\-\s]*(.*)$/i;
const ALL_CAPS_REGEX = /^[A-Z0-9 ,'&/\-()]{4,80}$/;

const SMALL_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "with",
  "at", "by", "as", "you", "your", "its", "under", "between"
]);

function isTitleHeading(line: string): boolean {
  const trimmed = line.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 10) return false;

  // Not a heading if ending in sentence punctuation
  if (/[.!?]$/.test(trimmed)) return false;

  let caps = 0;
  let significant = 0;
  for (const w of words) {
    const clean = w.replace(/^[("'[]|[)"'\].,;:]$/g, "").toLowerCase();
    if (!clean || SMALL_WORDS.has(clean)) continue;
    significant++;
    const firstChar = w[0];
    if (firstChar && firstChar === firstChar.toUpperCase() && /[A-Z0-9]/.test(firstChar)) {
      caps++;
    }
  }

  return significant > 0 && caps / significant >= 0.7;
}

function splitHeadingAndBody(remainder: string): { heading: string | null; inlineBody: string | null } {
  const trimmed = remainder.trim();
  if (!trimmed) {
    return { heading: null, inlineBody: null };
  }

  // Check for colon separator: "Scope of License: Licensor grants..."
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0 && colonIdx <= 60) {
    const candidateHeading = trimmed.slice(0, colonIdx).trim();
    const words = candidateHeading.split(/\s+/).filter(Boolean);
    if (words.length <= 10) {
      const candidateBody = trimmed.slice(colonIdx + 1).trim();
      return { heading: candidateHeading, inlineBody: candidateBody || null };
    }
  }

  // Check for dash separator: "Article II - Warranties"
  const dashIdx = trimmed.indexOf(" - ");
  if (dashIdx > 0 && dashIdx <= 60) {
    const candidateHeading = trimmed.slice(0, dashIdx).trim();
    const candidateBody = trimmed.slice(dashIdx + 3).trim();
    return { heading: candidateHeading || candidateBody, inlineBody: null };
  }

  // Short title without sentence punctuation
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 8 && !/[.!?]/.test(trimmed)) {
    return { heading: trimmed, inlineBody: null };
  }

  return { heading: null, inlineBody: trimmed };
}

interface DetectedMarker {
  number: string | null;
  heading: string | null;
  inlineBody: string | null;
  lineStartOffset: number;
  lineEndOffset: number;
}

function detectLineMarker(line: string, lineStartOffset: number): DetectedMarker | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 1. Numbered: "1. Scope", "1.1 Fees", "(1) Term"
  const numMatch = trimmed.match(NUMBERED_REGEX);
  if (numMatch) {
    const num = numMatch[1] || numMatch[2];
    const { heading, inlineBody } = splitHeadingAndBody(numMatch[3]);
    return {
      number: num,
      heading,
      inlineBody,
      lineStartOffset,
      lineEndOffset: lineStartOffset + line.length,
    };
  }

  // 2. Labeled: "Section 1: Definitions", "Article II - Warranties"
  const labMatch = trimmed.match(LABELED_REGEX);
  if (labMatch) {
    const num = labMatch[1];
    const rest = labMatch[2] ? labMatch[2].replace(/^[-.:)\s]+/, "") : "";
    const { heading, inlineBody } = splitHeadingAndBody(rest);
    return {
      number: num,
      heading: heading || (rest && !inlineBody ? rest : null),
      inlineBody,
      lineStartOffset,
      lineEndOffset: lineStartOffset + line.length,
    };
  }

  // 3. Lettered: "(a) Scope", "a. Scope"
  const letMatch = trimmed.match(LETTERED_REGEX);
  if (letMatch) {
    const num = letMatch[1] || letMatch[2];
    const { heading, inlineBody } = splitHeadingAndBody(letMatch[3]);
    return {
      number: num,
      heading,
      inlineBody,
      lineStartOffset,
      lineEndOffset: lineStartOffset + line.length,
    };
  }

  // 4. Standalone ALL CAPS
  if (ALL_CAPS_REGEX.test(trimmed) && trimmed.length >= 4 && !/[.!?]$/.test(trimmed)) {
    return {
      number: null,
      heading: trimmed,
      inlineBody: null,
      lineStartOffset,
      lineEndOffset: lineStartOffset + line.length,
    };
  }

  // 5. Standalone Title Heading
  if (isTitleHeading(trimmed)) {
    return {
      number: null,
      heading: trimmed,
      inlineBody: null,
      lineStartOffset,
      lineEndOffset: lineStartOffset + line.length,
    };
  }

  return null;
}

/**
 * Splits canonical contract text into clause units with exact start/end offsets.
 */
export function splitClauses(canonicalText: string): SplitResult {
  if (!canonicalText || !canonicalText.trim()) {
    return {
      clauses: [],
      confidence: 1.0,
      hasUncertainty: false,
    };
  }

  // Break text into lines while keeping track of character offsets
  const lines: { text: string; start: number; end: number }[] = [];
  let curOffset = 0;
  const rawLines = canonicalText.split("\n");

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    lines.push({
      text: line,
      start: curOffset,
      end: curOffset + line.length,
    });
    curOffset += line.length + 1; // + 1 for \n
  }

  interface IntermediateClause {
    number: string | null;
    heading: string | null;
    start: number;
    end: number;
    lines: string[];
  }

  const structuredClauses: IntermediateClause[] = [];
  let currentClause: IntermediateClause | null = null;
  let markersFound = 0;

  for (const line of lines) {
    const marker = detectLineMarker(line.text, line.start);

    if (marker) {
      markersFound++;
      if (currentClause) {
        structuredClauses.push(currentClause);
      }
      currentClause = {
        number: marker.number,
        heading: marker.heading,
        start: marker.lineStartOffset,
        end: marker.lineEndOffset,
        lines: marker.inlineBody ? [marker.inlineBody] : [],
      };
    } else {
      if (currentClause) {
        currentClause.end = line.end;
        if (line.text.trim()) {
          currentClause.lines.push(line.text);
        }
      } else {
        // Preamble before first clause
        if (line.text.trim()) {
          currentClause = {
            number: null,
            heading: "Preamble",
            start: line.start,
            end: line.end,
            lines: [line.text],
          };
        }
      }
    }
  }

  if (currentClause) {
    structuredClauses.push(currentClause);
  }

  // Assess confidence:
  // If we found 2 or more structural markers, confidence is high.
  // If no or only 1 marker was found, fallback to paragraph-based splitting with uncertainty.
  if (markersFound >= 2 && structuredClauses.length >= 2) {
    const clauses: ClauseUnit[] = structuredClauses.map((sc, idx) => {
      // Find exact text slice in canonicalText
      const slice = canonicalText.slice(sc.start, sc.end).trim();
      const bodyText = sc.lines.join("\n").trim() || slice;
      return {
        id: `clause-${idx + 1}`,
        order: idx,
        number: sc.number,
        heading: sc.heading,
        text: bodyText,
        start: sc.start,
        end: sc.end,
      };
    });

    const confidence = Math.min(1.0, 0.75 + (markersFound / structuredClauses.length) * 0.25);
    return {
      clauses,
      confidence: Number(confidence.toFixed(2)),
      hasUncertainty: false,
    };
  }

  // Fallback: Paragraph splitting on double newlines
  const paragraphs: { text: string; start: number; end: number }[] = [];
  const paraRegex = /\S+(?:[^\n]|\n(?!\n))*/g;
  let match: RegExpExecArray | null;

  while ((match = paraRegex.exec(canonicalText)) !== null) {
    paragraphs.push({
      text: match[0].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const fallbackClauses: ClauseUnit[] = paragraphs.map((p, idx) => ({
    id: `clause-${idx + 1}`,
    order: idx,
    number: null,
    heading: null,
    text: p.text,
    start: p.start,
    end: p.end,
  }));

  return {
    clauses: fallbackClauses,
    confidence: 0.45,
    hasUncertainty: true,
    reason: "No formal clause numbering or section headings detected; split using paragraph breaks.",
  };
}
