/**
 * Types for PDF viewer and verified citation highlighting.
 * Architecture.md §9, PRD FR-5.
 */

export interface ActiveQuoteTarget {
  quoteId: string;
  ref: string; // e.g. "Q1"
  documentId: string;
  documentName: string;
  text: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  occurrences?: number;
  ranges?: Array<{
    segment?: string;
    primary?: { start: number; end: number; pageStart: number; pageEnd: number };
    occurrences?: Array<{ start: number; end: number; pageStart: number; pageEnd: number }>;
  }>;
  currentOccurrenceIndex: number; // 0-based
}
