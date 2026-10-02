/**
 * Text normalisation and offset maps (Architecture.md SS6).
 *
 * Every output character carries a source-offset so callers can map
 * normalised positions back to canonical-text positions.
 *
 * INVARIANT (I-4): Nothing fuzzy may ever be added here.
 * The only tolerances are the exact steps listed below.
 */

/** A normalised string paired with its character-to-source offset map. */
export interface NormView {
  /** The normalised string. */
  s: string;
  /**
   * map[i] = position in the original (canonical) string that produced s[i].
   * Sentinel: map[s.length] = original.length  (one past the last character).
   */
  map: number[];
}

// ---------------------------------------------------------------------------
// Low-level character translation helpers
// ---------------------------------------------------------------------------

/** True if cp is a zero-width / invisible glyph that should be dropped. */
function isZeroWidth(cp: number): boolean {
  return (
    cp === 0x00ad || // soft hyphen
    cp === 0x200b || // zero-width space
    cp === 0x200c || // zero-width non-joiner
    cp === 0x200d || // zero-width joiner
    cp === 0xfeff    // BOM / zero-width no-break space
  );
}

/** True if cp is whitespace for our purposes (including NBSP, vertical tabs, etc.) */
function isWhitespace(cp: number): boolean {
  if (
    cp === 0x0020 || // space
    cp === 0x00a0 || // non-breaking space
    cp === 0x0009 || // tab
    cp === 0x000a || // LF
    cp === 0x000b || // VT
    cp === 0x000c || // FF
    cp === 0x000d || // CR
    cp === 0x2028 || // line separator
    cp === 0x2029 || // paragraph separator
    cp === 0x202f || // narrow no-break space
    cp === 0x3000    // ideographic space
  ) {
    return true;
  }
  return false;
}

/**
 * Translate one codepoint applying all single-character substitutions.
 * Returns the string to emit, or "" to drop the character.
 */
function translateCodepoint(cp: number): string {
  if (isZeroWidth(cp)) return "";

  // Curly single quotes -> straight apostrophe
  if (cp === 0x2018 || cp === 0x2019 || cp === 0x201a || cp === 0x201b) return "'";

  // Curly double quotes -> straight double quote
  if (
    cp === 0x201c || cp === 0x201d || cp === 0x201e || cp === 0x201f ||
    cp === 0x00ab || cp === 0x00bb
  ) return '"';

  // En dash, em dash, minus sign, non-breaking hyphen, figure dash, horizontal bar -> hyphen-minus
  if (
    cp === 0x2013 || // en dash
    cp === 0x2014 || // em dash
    cp === 0x2212 || // minus sign
    cp === 0x2011 || // non-breaking hyphen
    cp === 0x2012 || // figure dash
    cp === 0x2015    // horizontal bar
  ) return "-";

  // Ellipsis codepoint -> three ASCII dots so split-ellipsis still works
  if (cp === 0x2026) return "...";

  return String.fromCodePoint(cp);
}

// ---------------------------------------------------------------------------
// NFKC per-codepoint with offset tracking
// ---------------------------------------------------------------------------

/**
 * Apply NFKC normalisation codepoint-by-codepoint so every output character
 * retains its source offset.  NFKC can expand ligatures ("fi-ligature" to "fi"),
 * so one input codepoint may produce multiple output characters - all share the
 * same source offset.
 */
function nfkcWithOffsets(s: string): { chars: string[]; offsets: number[] } {
  const chars: string[] = [];
  const offsets: number[] = [];

  let srcIdx = 0;
  for (const char of s) {
    const expanded = char.normalize("NFKC");
    for (const outChar of expanded) {
      chars.push(outChar);
      offsets.push(srcIdx);
    }
    srcIdx += char.length; // handles surrogate pairs (length 2)
  }

  return { chars, offsets };
}

// ---------------------------------------------------------------------------
// Core normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a string and return a NormView.
 *
 * Steps (Architecture.md SS6, steps 1-4):
 *  1. Unicode NFKC per code point (ligature expansion with offset tracking).
 *  2. Curly quotes, dashes, ellipsis codepoint translation.
 *  3. Drop soft hyphen and zero-width characters.
 *  4. Collapse whitespace runs (including NBSP, LF, CR) -> single space; trim.
 */
export function normalise(s: string): NormView {
  // Steps 1-3: NFKC + translation
  const { chars, offsets } = nfkcWithOffsets(s);

  const outChars: string[] = [];
  const outOffsets: number[] = [];

  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0)!;
    const replacement = translateCodepoint(cp);
    if (replacement === "") continue;
    for (const c of replacement) {
      outChars.push(c);
      outOffsets.push(offsets[i]);
    }
  }

  // Step 4: collapse whitespace runs and trim.
  const finalChars: string[] = [];
  const finalOffsets: number[] = [];

  let inWhitespace = false;
  let firstWsOffset = 0;

  for (let i = 0; i < outChars.length; i++) {
    const cp = outChars[i].codePointAt(0)!;
    if (isWhitespace(cp)) {
      if (!inWhitespace) {
        inWhitespace = true;
        firstWsOffset = outOffsets[i];
      }
    } else {
      if (inWhitespace) {
        inWhitespace = false;
        // Only emit the space if there's already content (trim leading whitespace).
        if (finalChars.length > 0) {
          finalChars.push(" ");
          finalOffsets.push(firstWsOffset);
        }
      }
      finalChars.push(outChars[i]);
      finalOffsets.push(outOffsets[i]);
    }
  }
  // Trailing whitespace is not emitted (trim).

  // Sentinel: one past the last character in the original string.
  const sentinel = s.length;

  return {
    s: finalChars.join(""),
    map: [...finalOffsets, sentinel],
  };
}

// Keep view is plain normalise.
export const keepView = normalise;

// ---------------------------------------------------------------------------
// Join view (de-hyphenate line-break hyphens)
// ---------------------------------------------------------------------------

/**
 * Join view: after keep-view normalisation, remove "-" + " " when flanked by
 * a Unicode letter on the left and a Unicode lowercase letter on the right.
 * This handles line-break hyphenation (e.g. "termi- nation" -> "termination").
 */
export function joinView(s: string): NormView {
  const base = normalise(s);
  const src = base.s;
  const map = base.map;

  const outChars: string[] = [];
  const outOffsets: number[] = [];

  let i = 0;
  while (i < src.length) {
    // Pattern: LETTER [i-1] "-" [i] " " [i+1] LOWERCASE [i+2]
    if (
      i + 2 < src.length &&
      src[i] === "-" &&
      src[i + 1] === " " &&
      i > 0 &&
      /\p{L}/u.test(src[i - 1]) &&
      /\p{Ll}/u.test(src[i + 2])
    ) {
      // Skip hyphen and space.
      i += 2;
      continue;
    }
    outChars.push(src[i]);
    outOffsets.push(map[i]);
    i++;
  }

  const sentinel = map[src.length];
  return {
    s: outChars.join(""),
    map: [...outOffsets, sentinel],
  };
}

// ---------------------------------------------------------------------------
// Loose key (whitespace-free fallback)
// ---------------------------------------------------------------------------

/**
 * Loose key: remove ALL whitespace from the keep view.
 * Used ONLY as a last-resort fallback for extraction glitches that glue or
 * split words ("theParties", "Termi nation").
 * NEVER used as the primary or secondary search strategy.
 */
export function looseKey(s: string): NormView {
  const base = normalise(s);
  const src = base.s;
  const map = base.map;

  const outChars: string[] = [];
  const outOffsets: number[] = [];

  for (let i = 0; i < src.length; i++) {
    const cp = src.codePointAt(i)!;
    if (!isWhitespace(cp)) {
      outChars.push(src[i]);
      outOffsets.push(map[i]);
    }
  }

  const sentinel = map[src.length];
  return {
    s: outChars.join(""),
    map: [...outOffsets, sentinel],
  };
}
