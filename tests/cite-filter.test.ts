import { describe, it, expect } from "vitest";
import { createCitationFilter } from "@/lib/qa/cite-filter";

describe("Phase 3 - createCitationFilter", () => {
  it("passes verified citations intact when provided as single token", () => {
    const verified = new Set(["Q1", "Q2"]);
    const filter = createCitationFilter(verified);

    const out1 = filter.push("The cap is AED 100,000 [Q1].");
    const out2 = filter.push(" Notice must be 30 days [Q2].");
    const flush = filter.flush();

    expect(out1 + out2 + flush).toBe(
      "The cap is AED 100,000 [Q1]. Notice must be 30 days [Q2]."
    );
  });

  it("handles citations split across token boundaries", () => {
    const verified = new Set(["Q1", "Q2"]);
    const filter = createCitationFilter(verified);

    // Split "[Q1]" into "[", "Q", "1", "]"
    const t1 = filter.push("According to section 4 [");
    const t2 = filter.push("Q");
    const t3 = filter.push("1");
    const t4 = filter.push("], the limit applies.");
    const flush = filter.flush();

    expect(t1 + t2 + t3 + t4 + flush).toBe(
      "According to section 4 [Q1], the limit applies."
    );
  });

  it("silently drops unverified or unknown citation markers", () => {
    const verified = new Set(["Q1"]); // Q2 is not verified
    const filter = createCitationFilter(verified);

    const t1 = filter.push("Verified fact [Q1]. Unverified fact [Q2].");
    const flush = filter.flush();

    expect(t1 + flush).toBe("Verified fact [Q1]. Unverified fact .");
  });

  it("drops unverified citations split across tokens", () => {
    const verified = new Set(["Q1"]);
    const filter = createCitationFilter(verified);

    const t1 = filter.push("Invented fact [");
    const t2 = filter.push("Q99");
    const t3 = filter.push("].");
    const flush = filter.flush();

    expect(t1 + t2 + t3 + flush).toBe("Invented fact .");
  });

  it("passes normal brackets and non-citation text through", () => {
    const verified = new Set(["Q1"]);
    const filter = createCitationFilter(verified);

    const out = filter.push("See [Attachment A] and [Exhibit 1] for details.");
    const flush = filter.flush();

    expect(out + flush).toBe(
      "See [Attachment A] and [Exhibit 1] for details."
    );
  });

  it("discards incomplete citation markers on flush at end of stream", () => {
    const verified = new Set(["Q1"]);
    const filter = createCitationFilter(verified);

    const t1 = filter.push("Some trailing statement [Q");
    const flush = filter.flush();

    // Partial [Q should be dropped on stream completion, not left hanging
    expect(t1).toBe("Some trailing statement ");
    expect(flush).toBe("");
  });
});
