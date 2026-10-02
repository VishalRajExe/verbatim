/**
 * Phase 2 - Text normalisation, views, and split-ellipsis unit tests.
 * Pure functions only - no database.
 * Covers normalisation correctness and all view types.
 */
import { describe, it, expect } from "vitest";
import { normalise, keepView, joinView, looseKey } from "@/lib/text/normalize";
import { splitEllipsis } from "@/lib/verify/split-ellipsis";

describe("normalise() - core normalisation", () => {
  it("NFKC: fi-ligature expands to two characters", () => {
    const r = normalise("\uFB01nalised"); // fi-ligature
    expect(r.s).toBe("finalised");
    // Both 'f' and 'i' must map back to offset 0 (same source codepoint U+FB01 = length 1)
    expect(r.map[0]).toBe(0);
    expect(r.map[1]).toBe(0);
    // 'n' is the second JS character in the original string (offset 1)
    expect(r.map[2]).toBe(1);
  });

  it("curly single quotes -> straight", () => {
    expect(normalise("\u2018hello\u2019").s).toBe("'hello'");
  });

  it("curly double quotes -> straight", () => {
    expect(normalise("\u201cworld\u201d").s).toBe('"world"');
  });

  it("en dash -> hyphen-minus", () => {
    expect(normalise("AED 500,000 \u2013 cap").s).toBe("AED 500,000 - cap");
  });

  it("em dash -> hyphen-minus", () => {
    expect(normalise("answer\u2014now").s).toBe("answer-now");
  });

  it("NBSP -> single space (collapsed)", () => {
    expect(normalise("30\u00a0days").s).toBe("30 days");
  });

  it("multiple whitespace (including newline) -> single space", () => {
    expect(normalise("a  \n  b").s).toBe("a b");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalise("  hello  ").s).toBe("hello");
  });

  it("soft hyphen is removed", () => {
    // U+00AD soft hyphen
    expect(normalise("busi\u00adness").s).toBe("business");
  });

  it("zero-width space is removed", () => {
    expect(normalise("hello\u200bworld").s).toBe("helloworld");
  });

  it("ellipsis codepoint -> three dots", () => {
    expect(normalise("text\u2026more").s).toBe("text...more");
  });

  it("offset map sentinel is source.length", () => {
    const src = "hello";
    const r = normalise(src);
    expect(r.map[r.s.length]).toBe(src.length);
  });

  it("offset map tracks whitespace collapse correctly", () => {
    // "a   b" -> "a b"; the space maps to the first whitespace position (1)
    const r = normalise("a   b");
    expect(r.s).toBe("a b");
    expect(r.map[0]).toBe(0); // 'a'
    expect(r.map[1]).toBe(1); // first of the three spaces
    expect(r.map[2]).toBe(4); // 'b'
  });
});

describe("joinView() - de-hyphenate line-break hyphens", () => {
  it("removes hyphen+space between letter and lowercase letter", () => {
    // "termi- nated" should become "terminated"
    const r = joinView("termi- nated");
    expect(r.s).toBe("terminated");
  });

  it("does NOT remove hyphen before uppercase letter", () => {
    const r = joinView("Non- Exclusive");
    // 'E' is uppercase -> hyphen preserved
    expect(r.s).toContain("-");
  });

  it("does NOT remove hyphen at start of string", () => {
    const r = joinView("- value");
    expect(r.s.startsWith("-")).toBe(true);
  });

  it("does NOT remove standalone hyphen (no following space)", () => {
    const r = joinView("co-operation");
    expect(r.s).toBe("co-operation");
  });

  it("handles multiple hyphenations in one string", () => {
    const r = joinView("termi- nated and re- structured");
    // 'n' is lowercase, 's' is lowercase -> both hyphens are removed.
    expect(r.s).toBe("terminated and restructured");
  });
});

describe("looseKey() - whitespace-free fallback", () => {
  it("removes all whitespace", () => {
    const r = looseKey("the Parties agree");
    expect(r.s).toBe("thePartiesagree");
  });

  it("handles glued words (already no whitespace)", () => {
    const r = looseKey("TheParties");
    expect(r.s).toBe("TheParties");
  });

  it("still applies other normalisation (dashes, curly quotes)", () => {
    const r = looseKey("\u201chello\u201d \u2013 world");
    expect(r.s).toBe('"hello"-world');
  });
});

describe("splitEllipsis()", () => {
  it("returns single segment if no ellipsis", () => {
    const segs = splitEllipsis("simple text without ellipsis");
    expect(segs).toEqual(["simple text without ellipsis"]);
  });

  it("splits on ... (three dots)", () => {
    const segs = splitEllipsis("first segment ... second segment");
    expect(segs).toHaveLength(2);
    expect(segs[0]).toBe("first segment");
    expect(segs[1]).toBe("second segment");
  });

  it("splits on [...] notation", () => {
    const segs = splitEllipsis("first part [...] second part");
    expect(segs).toHaveLength(2);
    expect(segs[0]).toBe("first part");
    expect(segs[1]).toBe("second part");
  });

  it("splits ellipsis codepoint (already normalised to ...)", () => {
    const segs = splitEllipsis("alpha ... beta");
    expect(segs).toHaveLength(2);
  });

  it("trims whitespace around segments", () => {
    const segs = splitEllipsis("  first  ...  second  ");
    expect(segs[0]).toBe("first");
    expect(segs[1]).toBe("second");
  });
});