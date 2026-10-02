import { describe, it, expect } from "vitest";
import {
  parseInstructionIntents,
  clauseContainsValue,
  extractActualValueInClause,
  normalizeValueForMatch,
} from "@/lib/redline/instruction-intent";
import { verifyEdits, RedlineRawEdit } from "@/lib/redline/verify-edits";

describe("Redline Source-Value Safety Invariants (Section 7)", () => {
  const docxTextView = [
    "SERVICES AGREEMENT",
    "1. Scope of Services. Supplier shall provide software development and consulting services.",
    "2. Fees and Payment. Customer shall pay invoices within 30 days of receipt. The upfront retainer shall be AED 500,000 for initial setup.",
    "3. Limitation of Liability. Except for liability that cannot lawfully be limited, each party's aggregate liability under this Agreement shall not exceed AED 100,000.",
    "4. Term and Termination. This Agreement shall commence on the Effective Date and continue for one year.",
  ].join("\n\n");

  const liabilityPassage =
    "Except for liability that cannot lawfully be limited, each party's aggregate liability under this Agreement shall not exceed AED 100,000.";
  const paymentPassage =
    "Fees and Payment. Customer shall pay invoices within 30 days of receipt.";

  describe("Instruction Intent & Value Matching", () => {
    it("extracts expectedOriginal and replacement from 'from X to Y'", () => {
      const intents = parseInstructionIntents(
        "Change the liability cap from AED 500,000 to AED 2,000,000."
      );
      expect(intents.length).toBe(1);
      expect(intents[0].expectedOriginal).toBe("AED 500,000");
      expect(intents[0].replacement).toBe("AED 2,000,000");
    });

    it("extracts multiple intents from compound instructions", () => {
      const intents = parseInstructionIntents(
        "Change the liability cap from AED 100,000 to AED 1,000,000 and change payment terms from 30 days to 60 days."
      );
      expect(intents.length).toBe(2);
      expect(intents[0].expectedOriginal).toBe("AED 100,000");
      expect(intents[0].replacement).toBe("AED 1,000,000");
      expect(intents[1].expectedOriginal).toBe("30 days");
      expect(intents[1].replacement).toBe("60 days");
    });

    it("leaves expectedOriginal undefined when only replacement is specified (Test 7)", () => {
      const intents = parseInstructionIntents(
        "Change the liability cap to AED 2,000,000."
      );
      expect(intents.length).toBe(1);
      expect(intents[0].expectedOriginal).toBeUndefined();
      expect(intents[0].replacement).toBe("AED 2,000,000");
    });

    it("verifies numerical exactness: AED 500,000 != AED 100,000", () => {
      expect(clauseContainsValue(liabilityPassage, "AED 100,000")).toBe(true);
      expect(clauseContainsValue(liabilityPassage, "AED 500,000")).toBe(false);
      expect(clauseContainsValue(liabilityPassage, "AED 2,000,000")).toBe(false);
    });

    it("extracts the actual value present in the clause when expectedOriginal mismatches", () => {
      const actualVal = extractActualValueInClause(liabilityPassage, "AED 500,000");
      expect(actualVal).toBe("AED 100,000");
    });
  });

  describe("TEST 1 — VALID (Instruction matches document)", () => {
    it("proposes 1 ready edit when expectedOriginal exists in the target clause", () => {
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 100,000",
          replacement: "AED 1,000,000",
          reason: "Increase liability cap to AED 1,000,000 as instructed.",
          passage: liabilityPassage,
          expectedOriginal: "AED 100,000",
          actualDocumentValue: "AED 100,000",
        },
      ];

      const result = verifyEdits(rawEdits, docxTextView);
      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(0);

      const edit = result.verifiedEdits[0];
      expect(edit.verified).toBe(true);
      expect(edit.target).toBe("AED 100,000");
      expect(edit.replacement).toBe("AED 1,000,000");
      expect(edit.expectedOriginal).toBe("AED 100,000");
      expect(edit.actualDocumentValue).toBe("AED 100,000");
    });
  });

  describe("TEST 2 — INVALID SOURCE VALUE (Precondition failure)", () => {
    it("drops edit when expectedOriginal (AED 500,000) does not match clause (AED 100,000)", () => {
      // In this case, expectedOriginal is "AED 500,000", but liabilityPassage has "AED 100,000"
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 500,000",
          replacement: "AED 2,000,000",
          reason: "Change liability cap to AED 2,000,000.",
          passage: liabilityPassage,
          expectedOriginal: "AED 500,000",
          actualDocumentValue: "AED 100,000",
        },
      ];

      const result = verifyEdits(rawEdits, docxTextView);
      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);

      const dropped = result.droppedEdits[0];
      expect(dropped.verified).toBe(false);
      expect(dropped.expectedOriginal).toBe("AED 500,000");
      expect(dropped.actualDocumentValue).toBe("AED 100,000");
      expect(dropped.dropReason).toContain("AED 500,000 was not found in the identified clause");
      expect(dropped.dropReason).toContain("The document contains AED 100,000 instead");
    });
  });

  describe("TEST 3 — INVALID SOURCE VALUE ELSEWHERE", () => {
    it("refuses edit when AED 500,000 exists elsewhere in Section 2 but NOT in Section 3", () => {
      // Note: docxTextView contains "AED 500,000" in Section 2 (payment retainer).
      // But the target clause for liability is Section 3, which contains "AED 100,000".
      // The presence of "AED 500,000" in Section 2 MUST NOT validate the liability cap edit!
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 500,000",
          replacement: "AED 2,000,000",
          reason: "Increase liability cap to AED 2,000,000.",
          passage: liabilityPassage, // points to liability clause
          expectedOriginal: "AED 500,000",
          actualDocumentValue: "AED 100,000",
        },
      ];

      const result = verifyEdits(rawEdits, docxTextView);
      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].dropReason).toContain("AED 500,000 was not found in the identified clause");
    });
  });

  describe("TEST 4 — DUPLICATE VALID VALUE (Disambiguation via context)", () => {
    it("uniquely resolves target when value appears multiple times in doc but once in target clause", () => {
      const docWithRepeated = [
        docxTextView,
        "5. Insurance. Aggregate coverage shall not exceed AED 100,000 per policy year.",
      ].join("\n\n");

      // "AED 100,000" appears twice in docWithRepeated.
      // But rawEdit has passage anchor pointing to the liability clause.
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 100,000",
          replacement: "AED 1,000,000",
          reason: "Change liability cap to AED 1,000,000.",
          passage: liabilityPassage,
          expectedOriginal: "AED 100,000",
          actualDocumentValue: "AED 100,000",
          contextBefore: "shall not exceed ",
          contextAfter: ".",
        },
      ];

      const result = verifyEdits(rawEdits, docWithRepeated);
      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(0);
      expect(result.verifiedEdits[0].matchStartIndex).toBeDefined();
    });
  });

  describe("TEST 5 — TWO IDENTICAL LIABILITY CLAUSES (Ambiguity rejection)", () => {
    it("safely drops edit when two identical clauses exist (never guess)", () => {
      const docWithDuplicateClauses = [
        docxTextView,
        "APPENDIX: Duplicate Term:",
        liabilityPassage, // Exact duplicate of the liability clause
      ].join("\n\n");

      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 100,000",
          replacement: "AED 1,000,000",
          reason: "Change liability cap.",
          passage: liabilityPassage,
          contextBefore: "shall not exceed ",
          contextAfter: ".",
        },
      ];

      const result = verifyEdits(rawEdits, docWithDuplicateClauses);
      expect(result.verifiedEdits.length).toBe(0);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.droppedEdits[0].dropReason).toContain("ambiguous");
    });
  });

  describe("TEST 6 — MULTIPLE EDITS (Independent verification)", () => {
    it("verifies multiple edits independently against their respective clauses", () => {
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 100,000",
          replacement: "AED 1,000,000",
          reason: "Increase liability cap.",
          passage: liabilityPassage,
          expectedOriginal: "AED 100,000",
          actualDocumentValue: "AED 100,000",
        },
        {
          target: "30 days",
          replacement: "60 days",
          reason: "Extend payment terms.",
          passage: paymentPassage,
          expectedOriginal: "30 days",
          actualDocumentValue: "30 days",
        },
      ];

      const result = verifyEdits(rawEdits, docxTextView);
      expect(result.verifiedEdits.length).toBe(2);
      expect(result.droppedEdits.length).toBe(0);
    });

    it("verifies valid edit while dropping invalid edit in compound instruction", () => {
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 500,000",
          replacement: "AED 2,000,000",
          reason: "Increase liability cap.",
          passage: liabilityPassage, // invalid: clause has 100,000
          expectedOriginal: "AED 500,000",
          actualDocumentValue: "AED 100,000",
        },
        {
          target: "30 days",
          replacement: "60 days",
          reason: "Extend payment terms.",
          passage: paymentPassage, // valid: clause has 30 days
          expectedOriginal: "30 days",
          actualDocumentValue: "30 days",
        },
      ];

      const result = verifyEdits(rawEdits, docxTextView);
      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(1);
      expect(result.verifiedEdits[0].target).toBe("30 days");
      expect(result.droppedEdits[0].expectedOriginal).toBe("AED 500,000");
    });
  });

  describe("TEST 7 — ONLY REPLACEMENT SPECIFIED", () => {
    it("verifies edit when user only specified replacement value without an expectedOriginal", () => {
      const rawEdits: RedlineRawEdit[] = [
        {
          target: "AED 100,000",
          replacement: "AED 2,000,000",
          reason: "Update liability cap to AED 2,000,000.",
          passage: liabilityPassage,
          expectedOriginal: undefined, // user did not say "from X"
          actualDocumentValue: "AED 100,000",
        },
      ];

      const result = verifyEdits(rawEdits, docxTextView);
      expect(result.verifiedEdits.length).toBe(1);
      expect(result.droppedEdits.length).toBe(0);
      expect(result.verifiedEdits[0].target).toBe("AED 100,000");
      expect(result.verifiedEdits[0].replacement).toBe("AED 2,000,000");
    });
  });
});
