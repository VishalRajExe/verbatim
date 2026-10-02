/**
 * NDJSON event definitions and encoder.
 *
 * The streaming route emits one JSON object per line (NDJSON).
 * Adapted from rag-over-pdf citations.ts NDJSON design.
 * Architecture §8 specifies these exact event types.
 */
import type { CoverageDoc } from "@/lib/qa/coverage";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface StatusReadingEvent {
  type: "status";
  stage: "reading";
  documentId: string;
  done: number;
  total: number;
}

export interface StatusVerifyingEvent {
  type: "status";
  stage: "verifying";
}

export interface StatusComposingEvent {
  type: "status";
  stage: "composing";
}

/** A quote event carries both verified and unverified quotes. */
export interface QuoteEventItem {
  ref: string;
  documentId: string;
  documentName: string;
  verified: boolean;
  matchKind: string | null;
  failReason: string | null;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  occurrences: number;
  ranges?: any;
}

export interface QuotesEvent {
  type: "quotes";
  quotes: QuoteEventItem[];
}

export interface CoverageEvent {
  type: "coverage";
  coverage: CoverageDoc[];
}

export interface TokenEvent {
  type: "token";
  text: string;
}

export interface DoneEvent {
  type: "done";
  messageId: string;
  status: "complete" | "stopped" | "error";
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type StreamEvent =
  | StatusReadingEvent
  | StatusVerifyingEvent
  | StatusComposingEvent
  | QuotesEvent
  | CoverageEvent
  | TokenEvent
  | DoneEvent
  | ErrorEvent;

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/** Encode a single event as an NDJSON line (JSON + newline). */
export function encodeEvent(event: StreamEvent): string {
  return JSON.stringify(event) + "\n";
}

/**
 * Parse a raw NDJSON buffer into complete events plus a trailing partial line.
 * Client calls this on each ReadableStream read.
 * Adapted from rag-over-pdf parseEvents.
 */
export function parseEvents(buffer: string): {
  events: StreamEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: StreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // Malformed line — ignore rather than abort the whole stream.
    }
  }
  return { events, rest };
}
