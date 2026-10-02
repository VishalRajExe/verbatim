import { describe, it, expect } from "vitest";
import { chunkDocument, charsToTokens } from "@/lib/qa/chunker";

describe("Phase 4 - Document Chunker (chunkDocument)", () => {
  it("keeps short documents as a single chunk", () => {
    const text = "This is a brief contract between Party A and Party B. Terms apply.";
    const chunks = chunkDocument(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].total).toBe(1);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe(text.length);
    expect(chunks[0].text).toBe(text);
  });

  it("handles empty string gracefully", () => {
    const chunks = chunkDocument("");
    expect(chunks).toEqual([]);
  });

  it("splits large documents at paragraph boundaries without exceeding token budget", () => {
    // Generate paragraphs of varying lengths
    const paragraphs: string[] = [];
    for (let i = 1; i <= 20; i++) {
      paragraphs.push(
        `Section ${i}. Clause ${i} provisions. The parties hereby agree to terms and conditions set forth under Schedule ${i}, which shall govern all transactions between them under this agreement.`
      );
    }
    const fullText = paragraphs.join("\n\n");

    // Use small maxTokens = 100 (400 chars) to force multiple chunks
    const maxTokens = 100;
    const chunks = chunkDocument(fullText, { maxTokens, overlapTokens: 10 });

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      // Every chunk must be within token budget
      expect(charsToTokens(chunk.text.length)).toBeLessThanOrEqual(maxTokens);
      // Chunk text must match canonical text slice exactly
      expect(chunk.text).toBe(fullText.slice(chunk.charStart, chunk.charEnd));
      // Total field must match array length
      expect(chunk.total).toBe(chunks.length);
    }

    // Verify splits happened at clean boundaries (e.g. at \n\n or \n or word boundaries)
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i];
      const next = chunks[i + 1];

      // Successive chunks have overlap: next.charStart < current.charEnd
      expect(next.charStart).toBeLessThan(current.charEnd);
      // Successive chunk starts strictly after previous chunk start
      expect(next.charStart).toBeGreaterThan(current.charStart);
    }
  });

  it("ensures no source text is lost across all chunks", () => {
    const paragraphs: string[] = [];
    for (let i = 1; i <= 30; i++) {
      paragraphs.push(`Article ${i}: Distinct text block with unique identifier [ID-${i}].`);
    }
    const fullText = paragraphs.join("\n\n");

    const maxTokens = 80;
    const chunks = chunkDocument(fullText, { maxTokens, overlapTokens: 15 });

    // Check that every article [ID-i] appears in at least one chunk
    for (let i = 1; i <= 30; i++) {
      const marker = `[ID-${i}]`;
      const foundInChunk = chunks.some((c) => c.text.includes(marker));
      expect(foundInChunk).toBe(true);
    }

    // Verify continuous coverage from index 0 to fullText.length
    let maxCovered = 0;
    for (const chunk of chunks) {
      expect(chunk.charStart).toBeLessThanOrEqual(maxCovered);
      maxCovered = Math.max(maxCovered, chunk.charEnd);
    }
    expect(maxCovered).toBe(fullText.length);
  });

  it("canonical ranges identify exact overlap regions", () => {
    const text =
      "Paragraph One: Liability is strictly limited to 100k.\n\n" +
      "Paragraph Two: Governing law shall be the laws of Dubai.\n\n" +
      "Paragraph Three: Notice period shall be thirty days prior to expiry.\n\n" +
      "Paragraph Four: This constitutes the entire agreement between the parties.";

    // Budget that splits into 2-3 chunks
    const chunks = chunkDocument(text, { maxTokens: 40, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length - 1; i++) {
      const c1 = chunks[i];
      const c2 = chunks[i + 1];

      const overlapStart = c2.charStart;
      const overlapEnd = c1.charEnd;

      expect(overlapStart).toBeLessThan(overlapEnd);

      // Overlap slice in text
      const overlapFromText = text.slice(overlapStart, overlapEnd);
      expect(overlapFromText.length).toBeGreaterThan(0);

      // Overlap appears at the end of c1 and start of c2
      expect(c1.text.endsWith(overlapFromText)).toBe(true);
      expect(c2.text.startsWith(overlapFromText)).toBe(true);
    }
  });

  it("splits continuous text without spaces safely without hanging", () => {
    const solidText = "A".repeat(1000);
    const chunks = chunkDocument(solidText, { maxTokens: 50, overlapTokens: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(charsToTokens(c.text.length)).toBeLessThanOrEqual(50);
      expect(c.text).toBe(solidText.slice(c.charStart, c.charEnd));
    }
  });
});
