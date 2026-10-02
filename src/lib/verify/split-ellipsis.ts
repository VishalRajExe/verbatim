/**
 * Splits a quote containing ellipsis markers into individual segments.
 * Architecture.md SS7: "if q contains an ellipsis... split into segments (each >=20 chars).
 * Verify each segment independently."
 *
 * Recognised markers:  ...   [...]   ...  (U+2026, already normalised to "..." by normalise())
 */

const ELLIPSIS_PATTERN = /\[?\.{3}\]?/g;

/**
 * If the text contains an ellipsis marker, split it into segments.
 * Returns an array of trimmed segments. Returns [text] if no ellipsis found.
 */
export function splitEllipsis(text: string): string[] {
  if (!ELLIPSIS_PATTERN.test(text)) return [text];
  ELLIPSIS_PATTERN.lastIndex = 0; // reset stateful regex

  const segments = text.split(ELLIPSIS_PATTERN).map((s) => s.trim()).filter(Boolean);
  return segments.length > 0 ? segments : [text];
}
