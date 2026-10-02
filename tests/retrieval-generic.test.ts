import { describe, it, expect } from "vitest";
import { extractQueryConcepts, scoreChunk, selectRelevantChunks } from "@/lib/qa/retrieval";
import type { Chunk } from "@/lib/qa/chunker";

describe("Generic Multi-Pass Concept Retrieval (No Hardcoding)", () => {
  it("extracts substantive concepts, phrases, and entity tokens without hardcoded rules", () => {
    const q1 = "What does the incident-report requirement say about the timeline for detection, containment, recovery and closure?";
    const c1 = extractQueryConcepts(q1);

    expect(c1.terms).toContain("incident");
    expect(c1.terms).toContain("report");
    expect(c1.terms).toContain("timeline");
    expect(c1.terms).toContain("detection");
    expect(c1.terms).toContain("containment");
    expect(c1.terms).toContain("recovery");
    expect(c1.terms).toContain("closure");
    expect(c1.phrases).toContain("incident report");

    // Rephrased question
    const q2 = "What deadline applies to the incident report covering detection, containment, recovery and closure?";
    const c2 = extractQueryConcepts(q2);
    expect(c2.terms).toContain("deadline");
    expect(c2.terms).toContain("incident");
    expect(c2.terms).toContain("report");
    expect(c2.phrases).toContain("incident report");

    // Unrelated general legal question
    const q3 = "Under what circumstances can either party terminate immediately upon material breach?";
    const c3 = extractQueryConcepts(q3);
    expect(c3.terms).toContain("circumstances");
    expect(c3.terms).toContain("party");
    expect(c3.terms).toContain("terminate");
    expect(c3.terms).toContain("material");
    expect(c3.terms).toContain("breach");
    expect(c3.terms).not.toContain("what");
    expect(c3.terms).not.toContain("under");
  });

  it("scores and ranks chunks based on concept density and coverage", () => {
    const syntheticChunks: Chunk[] = [
      {
        index: 0,
        total: 3,
        text: "Section 1: Scope of Services. The supplier shall provide software consulting. Invoices payable within 30 days.",
        charStart: 0,
        charEnd: 1000,
      },
      {
        index: 1,
        total: 3,
        text: "Section 14: Security Incidents. Supplier shall provide a written incident report within 24 hours of any confirmed security incident, together with a timeline showing detection, containment, recovery, and closure within five business days thereafter.",
        charStart: 1000,
        charEnd: 2000,
      },
      {
        index: 2,
        total: 3,
        text: "Section 28: Miscellaneous. Governing law shall be the laws of the UAE. Notices shall be in writing.",
        charStart: 2000,
        charEnd: 3000,
      },
    ];

    const result = selectRelevantChunks(
      syntheticChunks,
      "What does the incident-report requirement say about the timeline for detection, containment, recovery and closure?"
    );

    expect(result.selectedChunks.length).toBeGreaterThan(0);
    expect(result.selectedChunks[0].index).toBe(1); // Accurately selected Chunk 1
  });

  it("works with rephrased queries dynamically", () => {
    const syntheticChunks: Chunk[] = [
      {
        index: 0,
        total: 3,
        text: "Section 1: Scope of Services. The supplier shall provide software consulting.",
        charStart: 0,
        charEnd: 1000,
      },
      {
        index: 1,
        total: 3,
        text: "Section 14: Security Incidents. Supplier shall provide a written incident report within 24 hours, together with a timeline showing detection, containment, recovery, and closure within five business days thereafter.",
        charStart: 1000,
        charEnd: 2000,
      },
      {
        index: 2,
        total: 3,
        text: "Section 28: Miscellaneous. Governing law shall be the laws of the UAE.",
        charStart: 2000,
        charEnd: 3000,
      },
    ];

    const result = selectRelevantChunks(
      syntheticChunks,
      "What deadline applies to the incident report covering detection, containment, recovery and closure?"
    );

    expect(result.selectedChunks.some(c => c.index === 1)).toBe(true);
  });

  it("selects multiple sections when question concepts span multiple chunks", () => {
    const multiChunkContract: Chunk[] = [
      {
        index: 0,
        total: 3,
        text: "Clause A: Detection and Containment. Supplier shall immediately contain any unauthorized access.",
        charStart: 0,
        charEnd: 1000,
      },
      {
        index: 1,
        total: 3,
        text: "Clause B: Recovery and Closure. Supplier shall execute full system recovery and formal closure within 5 days.",
        charStart: 1000,
        charEnd: 2000,
      },
      {
        index: 2,
        total: 3,
        text: "Clause C: Unrelated tax provisions and governing language.",
        charStart: 2000,
        charEnd: 3000,
      },
    ];

    const result = selectRelevantChunks(
      multiChunkContract,
      "What are the obligations for containment and recovery?"
    );

    // Both Chunk 0 and Chunk 1 contain distinct question concepts
    expect(result.selectedChunks.some(c => c.index === 0)).toBe(true);
    expect(result.selectedChunks.some(c => c.index === 1)).toBe(true);
  });

  it("reads single-chunk documents completely without filtering", () => {
    const singleChunk: Chunk[] = [
      {
        index: 0,
        total: 1,
        text: "Short contract text.",
        charStart: 0,
        charEnd: 20,
      },
    ];

    const result = selectRelevantChunks(singleChunk, "What is the liability cap?");
    expect(result.selectedChunks.length).toBe(1);
    expect(result.isSelective).toBe(false);
  });
});
