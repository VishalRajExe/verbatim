import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { verifyEdits } from "@/lib/redline/verify-edits";
import { extractDocxText } from "@/lib/redline/view";
import { applyRedlines } from "@/lib/redline/apply";
import { extractTextFromBuffer } from "@adeu/core";
import { unzipSync } from "fflate";

describe("Redline Ambiguous Target Resolution Tests (Tests A - E)", () => {
  const repeatedDocxPath = path.resolve(
    process.cwd(),
    "tests/fixtures/synthetic_liability_repeated.docx"
  );
  let repeatedBuffer: Buffer;
  let repeatedTextView: string;
  let testDocId: string;

  beforeAll(async () => {
    repeatedBuffer = fs.readFileSync(repeatedDocxPath);
    repeatedTextView = await extractDocxText(repeatedBuffer);

    // Verify fixture has AED 100,000 appearing exactly twice
    const aedMatches = (repeatedTextView.match(/AED 100,000/g) || []).length;
    expect(aedMatches).toBe(2);

    // Seed test document in DB
    const doc = await db.document.create({
      data: {
        name: "synthetic_liability_repeated.docx",
        kind: "docx",
        sizeBytes: repeatedBuffer.length,
        status: "READY",
        text: {
          create: {
            text: repeatedTextView,
          },
        },
        file: {
          create: {
            original: repeatedBuffer as any,
          },
        },
      },
    });
    testDocId = doc.id;
  });

  afterAll(async () => {
    if (testDocId) {
      await db.redline.deleteMany({ where: { documentId: testDocId } });
      await db.document.delete({ where: { id: testDocId } }).catch(() => {});
    }
  });

  // TEST A
  describe("TEST A: Disambiguate identical target across clauses using surrounding context", () => {
    it("resolves liability cap occurrence when AED 100,000 appears twice globally", async () => {
      // AED 100,000 appears in:
      // 1) "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000."
      // 2) "Annual Support and Maintenance Fee shall be AED 100,000 payable annually in advance."
      const proposal = [
        {
          target: "AED 100,000",
          replacement: "AED 1,000,000",
          reason: "Increase liability cap to AED 1,000,000 as instructed.",
          contextBefore: "Supplier's aggregate liability under this Agreement shall not exceed ",
          contextAfter: ".",
          passage: "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.",
        },
      ];

      const result = verifyEdits(proposal, repeatedTextView);

      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(0);

      const verified = result.verifiedEdits[0];
      expect(verified.verified).toBe(true);
      expect(verified.target).toBe("AED 100,000");
      expect(verified.replacement).toBe("AED 1,000,000");
      expect(verified.occurrences).toBe(1); // Disambiguated down to exactly 1
      expect(typeof verified.matchStartIndex).toBe("number");
      expect(verified.matchedClause).toBeDefined();

      // Verify the start index points to the liability section, not maintenance fee
      const textAtMatch = repeatedTextView.slice(
        verified.matchStartIndex!,
        verified.matchStartIndex! + verified.target.length
      );
      expect(textAtMatch).toBe("AED 100,000");

      const surroundingText = repeatedTextView.slice(
        Math.max(0, verified.matchStartIndex! - 70),
        verified.matchStartIndex!
      );
      expect(surroundingText).toContain("liability");
      expect(surroundingText).not.toContain("Maintenance Fee");
    });

    it(
      "applies the disambiguated edit to DOCX: changes liability cap, leaves second occurrence untouched",
      async () => {
        // Find exact start index of liability occurrence in authoritative text view
        const target = "AED 100,000";
        const passage = "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.";
        const verifyRes = verifyEdits(
          [
            {
              target,
              replacement: "AED 1,000,000",
              reason: "Increase liability cap.",
              passage,
              contextBefore: "Supplier's aggregate liability under this Agreement shall not exceed ",
            },
          ],
          repeatedTextView
        );

        expect(verifyRes.verifiedEdits.length).toBe(1);
        const verifiedEdit = verifyRes.verifiedEdits[0];

        // Create Redline session in DB
        const session = await db.redline.create({
          data: {
            documentId: testDocId,
            instruction: "Change the liability cap from AED 100,000 to AED 1,000,000.",
            status: "PROPOSED",
            edits: [verifiedEdit] as any,
          },
        });

        // Apply redlines
        const applyResult = await applyRedlines(session.id);
        expect(applyResult.status).toBe("APPLIED");
        expect(applyResult.editsAppliedCount).toBe(1);
        expect(applyResult.validation.libreOfficeSmokeTestPassed).toBe(true);

        // Verify OOXML contents
        const unzipped = unzipSync(new Uint8Array(applyResult.outputBuffer));
        const documentXml = Buffer.from(unzipped["word/document.xml"]).toString("utf-8");

        // Verify w:del has AED 100,000 and w:ins has AED 1,000,000
        expect(documentXml).toContain("<w:del");
        expect(documentXml).toContain("<w:ins");
        expect(documentXml).toContain("AED 1,000,000");

        // Verify the SECOND occurrence "Annual Support and Maintenance Fee shall be AED 100,000" remains unchanged
        expect(documentXml).toContain("Annual Support and Maintenance Fee shall be AED 100,000");

        // Extract raw text from modified docx buffer
        const modifiedTextView = await extractTextFromBuffer(applyResult.outputBuffer, false);
        expect(modifiedTextView).toContain("AED 1,000,000");
        expect(modifiedTextView).toContain("Annual Support and Maintenance Fee shall be AED 100,000");
      },
      60000
    );
  });

  // TEST B
  describe("TEST B: Repeated target in semantically identical clauses (truly ambiguous)", () => {
    it("drops edit and requests more context when context matches multiple locations", () => {
      // Synthetic scenario where both clauses have identical context
      const duplicateClauseText =
        "Section A: The penalty shall be AED 500.\nSection B: The penalty shall be AED 500.";

      const proposal = [
        {
          target: "AED 500",
          replacement: "AED 1,000",
          reason: "Increase penalty.",
          contextBefore: "The penalty shall be ",
          // contextBefore matches BOTH Section A and Section B!
        },
      ];

      const result = verifyEdits(proposal, duplicateClauseText);

      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].verified).toBe(false);
      expect(result.droppedEdits[0].dropReason).toContain("ambiguous");
      expect(result.droppedEdits[0].dropReason).toContain("Please specify more surrounding context");
    });
  });

  // TEST C
  describe("TEST C: Target appears only once (simple exact match)", () => {
    it("verifies single-occurrence target directly via simple exact match", () => {
      const proposal = [
        {
          target: "software development and consulting services",
          replacement: "custom software engineering services",
          reason: "Clarify scope.",
        },
      ];

      const result = verifyEdits(proposal, repeatedTextView);

      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(0);
      expect(result.verifiedEdits[0].verified).toBe(true);
      expect(result.verifiedEdits[0].occurrences).toBe(1);
      expect(result.verifiedEdits[0].matchStartIndex).toBe(
        repeatedTextView.indexOf("software development and consulting services")
      );
    });
  });

  // TEST D
  describe("TEST D: Multiple edits resolve and verify independently", () => {
    it("verifies both liability cap and payment terms independently", () => {
      const proposal = [
        {
          target: "AED 100,000",
          replacement: "AED 1,000,000",
          reason: "Change liability cap.",
          contextBefore: "Supplier's aggregate liability under this Agreement shall not exceed ",
          passage: "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.",
        },
        {
          target: "thirty (30) days",
          replacement: "sixty (60) days",
          reason: "Extend payment terms.",
          contextBefore: "Invoices shall be paid within ",
          passage: "Invoices shall be paid within thirty (30) days of receipt.",
        },
      ];

      const result = verifyEdits(proposal, repeatedTextView);

      expect(result.allEdits.length).toBe(2);
      expect(result.verifiedEdits.length).toBe(2);
      expect(result.droppedEdits.length).toBe(0);

      const edit1 = result.verifiedEdits.find((e) => e.target === "AED 100,000");
      const edit2 = result.verifiedEdits.find((e) => e.target === "thirty (30) days");

      expect(edit1).toBeDefined();
      expect(edit1?.verified).toBe(true);
      expect(edit1?.occurrences).toBe(1);

      expect(edit2).toBeDefined();
      expect(edit2?.verified).toBe(true);
      expect(edit2?.occurrences).toBe(1);
    });
  });

  // TEST E
  describe("TEST E: Wrong source amount (never substitute automatically)", () => {
    it("drops edit when source amount is wrong (AED 500,000 instead of AED 100,000)", () => {
      const proposal = [
        {
          target: "AED 500,000",
          replacement: "AED 1,000,000",
          reason: "Change liability cap from AED 500,000 to AED 1,000,000.",
          contextBefore: "liability under this Agreement shall not exceed ",
        },
      ];

      const result = verifyEdits(proposal, repeatedTextView);

      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].verified).toBe(false);
      expect(result.droppedEdits[0].dropReason).toContain(
        "Target text was not found in the document"
      );
      // Ensure AED 100,000 was NEVER automatically substituted
      expect(result.droppedEdits[0].target).toBe("AED 500,000");
    });
  });
});
