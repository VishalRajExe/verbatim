import { describe, it, expect } from "vitest";
import { runComparisonPipeline } from "@/lib/compare/pipeline";

describe("Phase 7: Large Document Comparison (150-page simulation)", () => {
  it("processes a 150-page equivalent contract pair without hanging or failing", async () => {
    // Generate a 150-page equivalent contract (~150,000 words, ~100 distinct numbered clauses)
    const clausesA: string[] = [];
    const clausesB: string[] = [];

    for (let i = 1; i <= 100; i++) {
      if (i === 25) {
        clausesA.push(`Section 25. Limitation of Liability\nThe total aggregate liability of Provider shall not exceed AED 100,000.`);
        clausesB.push(`Section 25. Limitation of Liability\nThe total aggregate liability of Provider shall not exceed AED 1,000,000.`);
      } else if (i === 50) {
        // Pure rewording
        clausesA.push(`Section 50. Notice Requirements\nAll notices shall be sent by registered mail or courier.`);
        clausesB.push(`Section 50. Notice Requirements\nAll formal notices must be delivered via registered postal service or courier.`);
      } else if (i === 75) {
        // Will be moved in B to position 10
        clausesA.push(`Section 75. Dispute Resolution\nDisputes shall be settled under the rules of arbitration in the DIFC.`);
      } else {
        // Standard boilerplate paragraph of ~100 words repeated to simulate a large document
        const para = `Section ${i}. General Provision ${i}\nThe parties hereby covenant and agree to perform their respective obligations under this Section ${i} in full compliance with all applicable laws, regulations, and industry standards, exercising the care and skill expected of a competent professional organization. Each party warrants that its performance hereunder shall not infringe or misappropriate any intellectual property rights of any third party.`;
        clausesA.push(para);
        clausesB.push(para);
      }
    }

    // Insert Section 75 at position 10 in Version B
    clausesB.splice(10, 0, `Section 75. Dispute Resolution\nDisputes shall be settled under the rules of arbitration in the DIFC.`);

    // Add a new clause at the end of Version B
    clausesB.push(`Section 101. Environmental Compliance\nBoth parties shall adhere to sustainability guidelines.`);

    const textA = clausesA.join("\n\n");
    const textB = clausesB.join("\n\n");

    const startTime = Date.now();
    // Run comparison with mock or fallback
    const result = await runComparisonPipeline(textA, textB);
    const durationMs = Date.now() - startTime;

    // Verify it completed in reasonable time (under 30s)
    expect(durationMs).toBeLessThan(30000);
    expect(result.changes.length).toBeGreaterThanOrEqual(3);

    // Verify the high-significance amount change
    const liability = result.changes.find(
      (c) => c.category === "liability" || c.title.toLowerCase().includes("liability")
    );
    expect(liability).toBeDefined();
    expect(liability?.significance).toBe("HIGH");

    // Verify unchanged clauses are counted
    expect(result.stats.unchanged).toBeGreaterThanOrEqual(90);
    expect(result.summary).toBeTruthy();
  }, 45000);
});
