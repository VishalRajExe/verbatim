/**
 * Streaming-safe [Q#] citation filter.
 *
 * The compose model emits [Q1], [Q2] etc. inline in streamed tokens.
 * Because tokens may split a marker across boundaries ("[Q" + "2]"), we
 * must buffer partial markers before passing text to the client.
 *
 * Rules (FR-3.6, I-3):
 * - Only markers for VERIFIED quotes pass through.
 * - Unknown markers (no such Q# in the verified set) are silently dropped.
 * - The buffer is flushed at stream end; any incomplete marker is discarded.
 *
 * Adapted from rag-over-pdf encodeEvent / parseEvents streaming design.
 */

export type CitationFilterFlusher = (text: string) => void;

export interface CitationFilter {
  /** Feed a token chunk from the model. */
  push(token: string): string;
  /** Flush remaining buffer at end of stream. Any partial [Q# is dropped. */
  flush(): string;
}

/**
 * Create a citation filter for a specific set of verified quote refs.
 *
 * @param verifiedRefs - Set of valid ref strings, e.g. new Set(["Q1","Q2"]).
 */
export function createCitationFilter(verifiedRefs: Set<string>): CitationFilter {
  let buf = "";

  function processBuffer(): string {
    let out = "";

    // Walk buffer until we find a potential marker start.
    while (buf.length > 0) {
      const openIdx = buf.indexOf("[");
      if (openIdx === -1) {
        // No potential marker: flush everything.
        out += buf;
        buf = "";
        break;
      }

      // Flush text before the potential marker.
      if (openIdx > 0) {
        out += buf.slice(0, openIdx);
        buf = buf.slice(openIdx);
      }

      // buf now starts with "[". Look for closing "]".
      const closeIdx = buf.indexOf("]");
      if (closeIdx === -1) {
        // Incomplete marker — hold the buffer and wait for more tokens.
        break;
      }

      // We have a complete "[...]" candidate.
      const candidate = buf.slice(0, closeIdx + 1); // e.g. "[Q2]"
      const inner = buf.slice(1, closeIdx); // e.g. "Q2"
      buf = buf.slice(closeIdx + 1);

      // Check if inner matches /^Q\d+$/
      if (/^Q\d+$/.test(inner)) {
        if (verifiedRefs.has(inner)) {
          out += candidate; // keep the marker
        }
        // else: drop it (unknown or unverified)
      } else {
        // Not a citation marker — emit as-is.
        out += candidate;
      }
    }

    return out;
  }

  return {
    push(token: string): string {
      buf += token;
      return processBuffer();
    },
    flush(): string {
      // Discard any incomplete marker still in the buffer.
      const openIdx = buf.indexOf("[");
      let out = "";
      if (openIdx === -1) {
        out = buf;
      } else {
        // Output text before the incomplete marker; discard the rest.
        out = buf.slice(0, openIdx);
      }
      buf = "";
      return out;
    },
  };
}
