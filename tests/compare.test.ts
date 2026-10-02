import { describe, it, expect, vi } from "vitest";
import { splitClauses } from "@/lib/compare/clauses";
import { alignClauses, bigramDice } from "@/lib/compare/align";
import { calculateMaterialityFloor, enforceSignificanceFloor } from "@/lib/compare/materiality";
import { categorizeClause } from "@/lib/compare/categories";
import { runComparisonPipeline } from "@/lib/compare/pipeline";
import { CONTRACT_A, CONTRACT_B } from "./fixtures/compare-contracts";

describe("Phase 7: Clause Splitting (clauses.ts)", () => {
  it("splits numbered and headed clauses preserving canonical offsets", () => {
    const res = splitClauses(CONTRACT_A);
    expect(res.clauses.length).toBe(8);
    expect(res.confidence).toBeGreaterThanOrEqual(0.8);
    expect(res.hasUncertainty).toBe(false);

    // Verify first clause
    const c1 = res.clauses[0];
    expect(c1.number).toBe("1");
    expect(c1.heading).toBe("Preamble");
    expect(c1.text).toContain("This Master Services Agreement");
    expect(CONTRACT_A.slice(c1.start, c1.end)).toContain(c1.text);

    // Verify clause 5 (Limitation of Liability)
    const c5 = res.clauses[4];
    expect(c5.number).toBe("5");
    expect(c5.heading).toBe("Limitation of Liability");
    expect(c5.text).toContain("AED 100,000");
    expect(CONTRACT_A.slice(c5.start, c5.end)).toContain(c5.text);
  });

  it("handles various numbering styles: 1.1, (a), Section, Article", () => {
    const mixed = `Section 1. Definitions
"Services" means the consulting work.

Article II - Warranties
Vendor warrants the quality of the deliverables.

1.1 Performance Standards
All work shall meet industry standards.

(a) Subcontracting
Vendor may subcontract only with prior consent.`;

    const res = splitClauses(mixed);
    expect(res.clauses.length).toBe(4);
    expect(res.clauses[0].heading).toBe("Definitions");
    expect(res.clauses[1].heading).toBe("Warranties");
    expect(res.clauses[2].number).toBe("1.1");
    expect(res.clauses[3].number).toBe("a");
  });

  it("reports lower confidence and uncertainty when no clear clause markers exist", () => {
    const unstructured = `First paragraph of plain text without any numbering or titles.
It spans a couple of lines.

Second paragraph of text which is also just plain body text.
There are no section headers at all.`;

    const res = splitClauses(unstructured);
    expect(res.confidence).toBeLessThan(0.8);
    expect(res.hasUncertainty).toBe(true);
    expect(res.clauses.length).toBe(2);
  });
});

describe("Phase 7: Clause Alignment (align.ts)", () => {
  it("computes bigram-Dice similarity accurately", () => {
    expect(bigramDice("identical text", "identical text")).toBe(1);
    expect(bigramDice("abc", "xyz")).toBe(0);

    const s1 = "Provider shall perform the software development and consulting services described in each Statement of Work.";
    const s2 = "Provider will deliver the software engineering and advisory services detailed in each Statement of Work.";
    const sim = bigramDice(s1, s2);
    expect(sim).toBeGreaterThanOrEqual(0.6);
  });

  it("aligns Contract A and Contract B correctly on the fixture pair", () => {
    const splitA = splitClauses(CONTRACT_A);
    const splitB = splitClauses(CONTRACT_B);

    const alignment = alignClauses(splitA.clauses, splitB.clauses);

    // 1. AED 100,000 -> AED 1,000,000 (Liability) => MODIFIED
    const liabilityChange = alignment.changes.find(
      (c) => c.aClause?.heading?.includes("Liability") || c.bClause?.heading?.includes("Liability")
    );
    expect(liabilityChange).toBeDefined();
    expect(liabilityChange?.type).toBe("MODIFIED");
    expect(liabilityChange?.aClause?.text).toContain("AED 100,000");
    expect(liabilityChange?.bClause?.text).toContain("AED 1,000,000");

    // 2. Pure rewording (Scope of Services) => MODIFIED
    const scopeChange = alignment.changes.find(
      (c) => c.aClause?.heading?.includes("Scope") || c.bClause?.heading?.includes("Scope")
    );
    expect(scopeChange).toBeDefined();
    expect(scopeChange?.type).toBe("MODIFIED");

    // 3. Moved clause (Dispute Resolution) => MOVED (NOT Added + Removed)
    const disputeChange = alignment.changes.find(
      (c) => c.aClause?.heading?.includes("Dispute") || c.bClause?.heading?.includes("Dispute")
    );
    expect(disputeChange).toBeDefined();
    expect(disputeChange?.type).toBe("MOVED");

    // 4. Added clause (Data Protection) => ADDED
    const addedChange = alignment.changes.find(
      (c) => c.bClause?.heading?.includes("Data Protection")
    );
    expect(addedChange).toBeDefined();
    expect(addedChange?.type).toBe("ADDED");
    expect(addedChange?.aClause).toBeUndefined();

    // 5. Removed clause (Confidentiality) => REMOVED
    const removedChange = alignment.changes.find(
      (c) => c.aClause?.heading?.includes("Confidentiality")
    );
    expect(removedChange).toBeDefined();
    expect(removedChange?.type).toBe("REMOVED");
    expect(removedChange?.bClause).toBeUndefined();

    // 6. Unchanged clauses are counted
    expect(alignment.unchangedCount).toBeGreaterThanOrEqual(3);
  });

  it("classifies pure cosmetic differences as COSMETIC", () => {
    const textA = "1. Term: The Agreement shall commence on the Effective Date.";
    const textB = "1.   TERM:   The agreement shall commence on the effective date.  ";
    const splitA = splitClauses(textA);
    const splitB = splitClauses(textB);

    const alignment = alignClauses(splitA.clauses, splitB.clauses);
    expect(alignment.changes.length).toBe(1);
    expect(alignment.changes[0].significance).toBe("COSMETIC");
  });
});

describe("Phase 7: Materiality Rules (materiality.ts)", () => {
  it("rates amount change >= 2x as HIGH significance", () => {
    const oldText = "The total aggregate liability of either party shall not exceed AED 100,000.";
    const newText = "The total aggregate liability of either party shall not exceed AED 1,000,000.";
    const res = calculateMaterialityFloor("MODIFIED", oldText, newText, "liability");

    expect(res.floor).toBe("HIGH");
    expect(res.reasons.some((r) => r.toLowerCase().includes("amount") || r.toLowerCase().includes("2x") || r.toLowerCase().includes("factor"))).toBe(true);
  });

  it("rates direction change in liability / termination / payment / indemnity as HIGH", () => {
    const oldText = "Liability shall be limited to direct damages up to fees paid.";
    const newText = "Liability shall be unlimited for any breach or negligence.";
    const res = calculateMaterialityFloor("MODIFIED", oldText, newText, "liability");

    expect(res.floor).toBe("HIGH");
  });

  it("rates any changed material token (days, percentages, obligation words) as at least MEDIUM", () => {
    const oldText = "Customer shall pay within 30 days.";
    const newText = "Customer shall pay within 45 days.";
    const res = calculateMaterialityFloor("MODIFIED", oldText, newText, "payment");

    expect(res.floor).toBe("MEDIUM");
  });

  it("rates pure rewording without material token change as LOW or COSMETIC", () => {
    const oldText = "Provider shall perform the software development and consulting services described in each Statement of Work.";
    const newText = "Provider will deliver the software engineering and advisory services detailed in each Statement of Work.";
    const res = calculateMaterialityFloor("MODIFIED", oldText, newText, "general");

    expect(["LOW", "COSMETIC"]).toContain(res.floor);
  });

  it("strictly enforces that AI cannot lower significance below deterministic floor", () => {
    // Floor is HIGH, AI returns LOW -> must remain HIGH
    expect(enforceSignificanceFloor("LOW", "HIGH")).toBe("HIGH");
    expect(enforceSignificanceFloor("MEDIUM", "HIGH")).toBe("HIGH");
    expect(enforceSignificanceFloor("COSMETIC", "HIGH")).toBe("HIGH");

    // Floor is MEDIUM, AI returns HIGH -> raised to HIGH
    expect(enforceSignificanceFloor("HIGH", "MEDIUM")).toBe("HIGH");

    // Floor is MEDIUM, AI returns LOW -> kept at MEDIUM
    expect(enforceSignificanceFloor("LOW", "MEDIUM")).toBe("MEDIUM");
  });
});

describe("Phase 7: Clause Categorization (categories.ts)", () => {
  it("categorizes key clause types correctly", () => {
    expect(categorizeClause("Total liability of Supplier under this agreement shall not exceed...", "Limitation of Liability")).toBe("liability");
    expect(categorizeClause("Customer shall pay all undisputed invoices within 30 days...", "Payment Terms")).toBe("payment");
    expect(categorizeClause("Either party may terminate this agreement for convenience...", "Termination")).toBe("termination");
    expect(categorizeClause("Vendor shall defend, indemnify and hold harmless Customer...", "Indemnification")).toBe("indemnity");
    expect(categorizeClause("All proprietary confidential information disclosed...", "Confidentiality")).toBe("confidentiality");
    expect(categorizeClause("This contract is governed by the laws of England and Wales...", "Governing Law")).toBe("governing_law");
  });
});

describe("Phase 7: Single Passage Verification Requirement", () => {
  it("evaluates Version A AED 100,000 -> Version B AED 1,000,000 correctly", () => {
    const vA = "Liability shall not exceed AED 100,000.";
    const vB = "Liability shall not exceed AED 1,000,000.";

    const splitA = splitClauses(vA);
    const splitB = splitClauses(vB);
    const alignment = alignClauses(splitA.clauses, splitB.clauses);

    expect(alignment.changes.length).toBe(1);
    const change = alignment.changes[0];

    expect(change.type).toBe("MODIFIED");
    expect(change.aClause?.text).toBe(vA);
    expect(change.bClause?.text).toBe(vB);

    const mat = calculateMaterialityFloor("MODIFIED", vA, vB, "liability");
    expect(mat.floor).toBe("HIGH");

    const category = categorizeClause(vA, null);
    expect(category).toBe("liability");
  });
});

describe("Phase 7: AI Failure & Automatic Fallback (pipeline.ts)", () => {
  it("falls back to automatic token-diff summaries when AI call fails", async () => {
    // Mock AI call failure
    const mockLlm = {
      generateJson: vi.fn().mockRejectedValue(new Error("AI service unavailable (500)")),
    };

    const result = await runComparisonPipeline(CONTRACT_A, CONTRACT_B, {
      llm: mockLlm as any,
    });

    expect(result.changes.length).toBeGreaterThan(0);
    // All changes must have valid summaries labelled "automatic"
    for (const change of result.changes) {
      expect(change.summary).toBeTruthy();
      expect(change.summarySource).toBe("automatic");
    }

    // Amount change automatic summary check
    const liability = result.changes.find(
      (c) => c.title.toLowerCase().includes("liability") || c.summary.includes("AED")
    );
    expect(liability).toBeDefined();
    expect(liability?.significance).toBe("HIGH");
    expect(liability?.summary).toMatch(/AED\s*100,000.*AED\s*1,000,000/i);
    expect(result.summary).toBeTruthy();
  });
});
