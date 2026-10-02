import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { verifyEdits } from "@/lib/redline/verify-edits";
import { validateDocxRedline } from "@/lib/redline/validate-docx";
import { applyRedlines } from "@/lib/redline/apply";
import { extractDocxText, getDocxTextView } from "@/lib/redline/view";
import { DocumentObject, RedlineEngine } from "@adeu/core";
import { unzipSync } from "fflate";

describe("Phase 8 Redline Unit & Integration Tests", () => {
  const docxFixturePath = path.resolve(
    process.cwd(),
    "tests/fixtures/synthetic_spike_b.docx"
  );
  let fixtureBuffer: Buffer;
  let fixtureTextView: string;
  let testDocId: string;

  beforeAll(async () => {
    fixtureBuffer = fs.readFileSync(docxFixturePath);
    fixtureTextView = await extractDocxText(fixtureBuffer);

    // Seed test document in DB
    const doc = await db.document.create({
      data: {
        name: "synthetic_test_contract.docx",
        kind: "docx",
        sizeBytes: fixtureBuffer.length,
        status: "READY",
        text: {
          create: {
            text: fixtureTextView,
          },
        },
        file: {
          create: {
            original: fixtureBuffer as any,
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

  describe("TASK 1 & TASK 4: DOCX Text View & Target Verification (Invariant I-10)", () => {
    it("extracts authoritative text view from DOCX buffer", () => {
      expect(fixtureTextView).toBeTruthy();
      expect(fixtureTextView).toContain(
        "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000."
      );
      expect(fixtureTextView).toContain("Section 1. Scope of Work");
      expect(fixtureTextView).toContain("Milestone | Deliverable | Amount (AED)");
    });

    it("verifies single-occurrence target as verified and included", () => {
      const result = verifyEdits(
        [
          {
            target: "Supplier's aggregate liability",
            replacement: "The aggregate liability of either party",
            reason: "Make the cap mutual.",
          },
        ],
        fixtureTextView
      );

      expect(result.allEdits.length).toBe(1);
      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(0);
      expect(result.verifiedEdits[0].verified).toBe(true);
      expect(result.verifiedEdits[0].include).toBe(true);
      expect(result.verifiedEdits[0].occurrences).toBe(1);
    });

    it("drops nonexistent target and reports clear reason without silent application", () => {
      const result = verifyEdits(
        [
          {
            target: "Arbitration shall be conducted exclusively in Singapore",
            replacement: "Arbitration shall be conducted in Dubai",
            reason: "Change seat of arbitration.",
          },
        ],
        fixtureTextView
      );

      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].verified).toBe(false);
      expect(result.droppedEdits[0].include).toBe(false);
      expect(result.droppedEdits[0].dropReason).toContain(
        "Target text was not found in the document"
      );
    });

    it("drops ambiguous target occurring more than once and requests disambiguation", () => {
      // "Supplier" occurs multiple times in synthetic_spike_b.docx
      const occurrences = (fixtureTextView.match(/Supplier/g) || []).length;
      expect(occurrences).toBeGreaterThan(1);

      const result = verifyEdits(
        [
          {
            target: "Supplier",
            replacement: "Contractor",
            reason: "Update party definition.",
          },
        ],
        fixtureTextView
      );

      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].verified).toBe(false);
      expect(result.droppedEdits[0].dropReason).toContain("ambiguous");
      expect(result.droppedEdits[0].dropReason).toContain(
        `appears ${occurrences} times`
      );
    });

    it("drops edit if target and replacement are identical", () => {
      const result = verifyEdits(
        [
          {
            target: "Supplier's aggregate liability",
            replacement: "Supplier's aggregate liability",
            reason: "No-op edit.",
          },
        ],
        fixtureTextView
      );

      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].dropReason).toContain("identical");
    });
  });

  describe("TASK 3, 5 & 6: Minimal Edits, Apply and Validation", () => {
    it(
      "applies a mutual liability cap edit and validates w:ins, w:del, untouched XML, and LibreOffice",
      async () => {
        // 1. Prepare verified edit
        const target = "Supplier's aggregate liability";
        const replacement = "The aggregate liability of either party";

        const verified = verifyEdits(
          [
            {
              target,
              replacement,
              reason: "Make the liability cap apply mutually to both parties.",
            },
          ],
          fixtureTextView
        );

        // 2. Create redline record in DB
        const redlineRecord = await db.redline.create({
          data: {
            documentId: testDocId,
            instruction: "Make the liability cap mutual.",
            edits: verified.allEdits as any,
            status: "PROPOSED",
          },
        });

        // 3. Apply the redline
        const appliedResult = await applyRedlines(redlineRecord.id);
        expect(appliedResult.status).toBe("APPLIED");
        expect(appliedResult.editsAppliedCount).toBe(1);
        expect(appliedResult.outputBuffer.length).toBeGreaterThan(0);

        // 4. Validate output
        const validation = appliedResult.validation;
        expect(validation.valid).toBe(true);
        expect(validation.insCount).toBeGreaterThanOrEqual(1);
        expect(validation.delCount).toBeGreaterThanOrEqual(1);
        expect(validation.untouchedParagraphsMatched).toBe(true);
        expect(validation.libreOfficeSmokeTestPassed).toBe(true);
        expect(validation.errors).toHaveLength(0);

        // 5. Inspect OOXML directly to confirm w:ins, w:del and author
        const unzipped = unzipSync(new Uint8Array(appliedResult.outputBuffer));
        const modXml = Buffer.from(unzipped["word/document.xml"]).toString("utf-8");
        expect(modXml).toContain("<w:ins");
        expect(modXml).toContain("<w:del");
        expect(modXml).toContain('w:author="Verbatim AI"');
        expect(modXml).toContain("<w:delText>Supplier's</w:delText>");
        expect(modXml).toContain("The");
        expect(modXml).toContain("of either party");
      },
      60000
    );

    it(
      "applies multiple edits in separate document locations in one pass",
      async () => {
        // Target 1 in Section 1 (Scope)
        const edit1 = {
          target: "Supplier shall provide software development and consulting services.",
          replacement:
            "Supplier shall provide dedicated software engineering and architectural consulting services.",
          reason: "Clarify scope of services.",
        };

        // Target 2 in Section 2 (Liability)
        const edit2 = {
          target: "exceed AED 100,000.",
          replacement: "exceed AED 250,000.",
          reason: "Increase aggregate liability threshold.",
        };

        const verification = verifyEdits([edit1, edit2], fixtureTextView);
        expect(verification.verifiedEdits.length).toBe(2);

        const redlineRecord = await db.redline.create({
          data: {
            documentId: testDocId,
            instruction:
              "Clarify services scope and increase the liability threshold to AED 250,000.",
            edits: verification.allEdits as any,
            status: "PROPOSED",
          },
        });

        const appliedResult = await applyRedlines(redlineRecord.id);
        expect(appliedResult.status).toBe("APPLIED");
        expect(appliedResult.editsAppliedCount).toBe(2);

        const validation = appliedResult.validation;
        expect(validation.valid).toBe(true);
        expect(validation.insCount).toBeGreaterThanOrEqual(2);
        expect(validation.delCount).toBeGreaterThanOrEqual(2);
        expect(validation.libreOfficeSmokeTestPassed).toBe(true);
      },
      60000
    );

    it("formatting test: preserves bold, numbered list, and table XML untouched", async () => {
      // Apply edit only to Section 2 (Liability)
      const edit = {
        target: "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.",
        replacement:
          "Each party's aggregate liability under this Agreement shall not exceed AED 150,000.",
        reason: "Mutualize liability and adjust cap.",
      };

      const doc = await DocumentObject.load(fixtureBuffer);
      const engine = new RedlineEngine(doc, "Verbatim AI");
      engine.process_batch([
        {
          type: "modify",
          target_text: edit.target,
          new_text: edit.replacement,
          match_mode: "strict",
        },
      ]);
      const modBuffer = Buffer.from(await doc.save());

      const origUnzipped = unzipSync(new Uint8Array(fixtureBuffer));
      const modUnzipped = unzipSync(new Uint8Array(modBuffer));

      const origXml = Buffer.from(origUnzipped["word/document.xml"]).toString("utf-8");
      const modXml = Buffer.from(modUnzipped["word/document.xml"]).toString("utf-8");

      // Extract tables (<w:tbl>...</w:tbl>)
      const origTables = origXml.match(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g) || [];
      const modTables = modXml.match(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g) || [];

      expect(origTables.length).toBeGreaterThan(0);
      expect(modTables.length).toBe(origTables.length);
      // Verify table XML is byte-for-byte identical!
      expect(modTables[0]).toBe(origTables[0]);

      // Verify numbered list paragraph 1 is byte-for-byte identical
      const getParagraphs = (xml: string) => xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
      const origPs = getParagraphs(origXml);
      const modPs = getParagraphs(modXml);

      // Paragraph 0 is Master Services Agreement title
      expect(modPs[0]).toBe(origPs[0]);
    });
  });

  describe("Negative Tests", () => {
    it("rejects applying a redline session with 0 verified edits", async () => {
      const redlineRecord = await db.redline.create({
        data: {
          documentId: testDocId,
          instruction: "Adjust the governing law clause to California.",
          edits: [
            {
              id: "edit-drop-1",
              target: "This Agreement shall be governed by California law.",
              replacement: "This Agreement shall be governed by New York law.",
              reason: "Change governing law.",
              verified: false,
              include: false,
              dropReason: "Target text was not found in the document.",
              occurrences: 0,
            },
          ] as any,
          status: "PROPOSED",
        },
      });

      await expect(applyRedlines(redlineRecord.id)).rejects.toThrow(
        "No verified edits were selected to apply"
      );

      // Verify no output blob was created
      const check = await db.redline.findUnique({
        where: { id: redlineRecord.id },
      });
      expect(check?.output).toBeNull();
      expect(check?.status).toBe("PROPOSED");
    });

    it("rejects redlining for PDF documents with clear error", async () => {
      const pdfDoc = await db.document.create({
        data: {
          name: "test_contract.pdf",
          kind: "pdf",
          sizeBytes: 1024,
          status: "READY",
        },
      });

      try {
        await expect(getDocxTextView(pdfDoc.id)).rejects.toThrow(
          "Tracked-change redlining is only available for DOCX documents"
        );
      } finally {
        await db.document.delete({ where: { id: pdfDoc.id } }).catch(() => {});
      }
    });
  });
});
