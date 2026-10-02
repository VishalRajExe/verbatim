/**
 * Propose Tracked-Change Redline Edits (PRD FR-8, Architecture §11).
 *
 * Flow:
 * 1. Read authoritative DOCX text view (view.ts)
 * 2. Scan DOCX text-view chunks to identify relevant passages
 * 3. Verify passages exist verbatim in DOCX text view
 * 4. Request minimal edits from model:
 *    - target must be an exact substring of a verified passage
 *    - only modify words that need modification (NEVER rewrite entire clause)
 * 5. Verify each target occurs exactly once (verify-edits.ts)
 * 6. Store Redline(PROPOSED) in DB
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { chunkDocument } from "@/lib/qa/chunker";
import { getLlmClient, getLlmModel } from "@/lib/llm/client";
import { parseJson } from "@/lib/llm/json";
import { withRetry, assertNonEmptyContent } from "@/lib/llm/retry";
import { getDocxTextView } from "./view";
import {
  verifyEdits,
  RedlineRawEdit,
  RedlineVerifiedEdit,
  VerifyEditsResult,
} from "./verify-edits";

import {
  parseInstructionIntents,
  clauseContainsValue,
  extractActualValueInClause,
  normalizeValueForMatch,
} from "./instruction-intent";

const PassagesSchema = z.object({
  passages: z.array(z.string()),
});

const EditsSchema = z.object({
  edits: z.array(
    z.object({
      targetConcept: z.string().optional(),
      expectedOriginal: z.string().optional().nullable(),
      actualTargetInClause: z.string().optional().nullable(),
      target: z.string(),
      replacement: z.string(),
      reason: z.string(),
      contextBefore: z.string().optional(),
      contextAfter: z.string().optional(),
    })
  ),
});

export interface ProposeRedlineOptions {
  signal?: AbortSignal;
}

export interface ProposeRedlineResponse {
  id: string;
  documentId: string;
  instruction: string;
  status: string;
  edits: RedlineVerifiedEdit[];
  verifiedEdits: RedlineVerifiedEdit[];
  droppedEdits: RedlineVerifiedEdit[];
  message?: string;
  createdAt: string;
}

/**
 * Scans a chunk to identify passages relevant to the instruction.
 */
async function locatePassagesInChunk(
  chunkText: string,
  instruction: string,
  signal?: AbortSignal
): Promise<string[]> {
  const client = getLlmClient();
  const model = getLlmModel();

  const prompt = `You are an expert contract assistant.
A user has provided the following contract modification instruction:
"${instruction}"

Here is an excerpt from the contract:
----------------------------------------
${chunkText}
----------------------------------------

TASK:
Identify any specific sentence or passage in this excerpt that directly addresses or must be modified to fulfill the user's instruction.

RULES:
1. Quote each passage VERBATIM from the excerpt above. Do not paraphrase or alter a single word.
2. If this excerpt does not contain any relevant clauses, return an empty array.
3. Return valid JSON only with the schema:
{
  "passages": ["exact verbatim sentence or passage from text", ...]
}`;

  const completion = await withRetry(
    () =>
      client.chat.completions.create(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
        },
        signal ? { signal } : undefined
      ),
    signal
  );

  const raw = (() => {
    const content = completion.choices[0]?.message?.content;
    assertNonEmptyContent(content, "locatePassagesInChunk");
    return content;
  })();
  const parsed = await parseJson(raw, PassagesSchema);

  if (!parsed.ok || !parsed.data) {
    return [];
  }

  return parsed.data.passages.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Requests minimal edits for a verified passage.
 */
async function requestMinimalEditsForPassage(
  passage: string,
  instruction: string,
  signal?: AbortSignal
): Promise<RedlineRawEdit[]> {
  const client = getLlmClient();
  const model = getLlmModel();

  const prompt = `You are a precision contract lawyer proposing tracked-change redlines.

User Instruction: "${instruction}"

Verified Contract Passage:
"${passage}"

TASK:
Propose minimal tracked-change edits to fulfill the instruction.

INSTRUCTION ANALYSIS & VALUE PRECONDITION RULES:
1. Did the user instruction explicitly specify an original starting value to change FROM (e.g., "from X to Y", "change X to Y", "replace X with Y")?
   - If YES, record "expectedOriginal": "X" (exact text from the user's instruction).
   - If NO (e.g. "Change the liability cap to AED 2,000,000"), set "expectedOriginal": null.
2. CRITICAL PRECONDITION RULE (NEVER SUBSTITUTE SOURCE VALUE):
   Check if "expectedOriginal" exists in the Verified Contract Passage:
   - If "expectedOriginal" exists in the passage: Propose "target": "X", "actualTargetInClause": "X".
   - If "expectedOriginal" DOES NOT exist in the passage (for example, the user said "from AED 500,000 to AED 2,000,000" but the passage contains "AED 100,000"):
     DO NOT silently replace "AED 100,000"!
     Instead report:
     "expectedOriginal": "AED 500,000",
     "actualTargetInClause": "AED 100,000",
     "target": "AED 500,000",
     "replacement": "AED 2,000,000",
     "reason": "The user requested changing from AED 500,000, but the clause contains AED 100,000."
3. If no expectedOriginal was specified (e.g. "Change the liability cap to AED 2,000,000"):
   - "expectedOriginal": null
   - "actualTargetInClause": "AED 100,000"
   - "target": "AED 100,000"
   - "replacement": "AED 2,000,000"
   - "reason": "Update liability cap to AED 2,000,000."

CRITICAL RULES (TASK 3 - MINIMAL EDITS):
1. 'target' MUST be an exact verbatim substring of the Verified Contract Passage above.
2. ONLY modify the specific words that need to change.
   NEVER rewrite the entire clause, sentence, or paragraph.
   NEVER regenerate formatting or re-number clauses.
3. 'replacement' is the replacement text for the targeted words.
4. 'reason' is a concise 1-sentence legal/business rationale.
5. 'contextBefore' (optional but recommended): 3 to 10 words immediately preceding the target in the passage.
6. 'contextAfter' (optional but recommended): 3 to 10 words immediately following the target in the passage.

EXAMPLE:
Passage: "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000."
Instruction: "Change the liability cap from AED 100,000 to AED 1,000,000."
Correct minimal edit:
{
  "targetConcept": "liability cap",
  "expectedOriginal": "AED 100,000",
  "actualTargetInClause": "AED 100,000",
  "target": "AED 100,000",
  "replacement": "AED 1,000,000",
  "reason": "Increase liability cap to AED 1,000,000.",
  "contextBefore": "shall not exceed ",
  "contextAfter": "."
}

Return valid JSON with the schema:
{
  "edits": [
    {
      "targetConcept": "concept name",
      "expectedOriginal": "starting value or null",
      "actualTargetInClause": "actual value in clause",
      "target": "target substring",
      "replacement": "minimal replacement",
      "reason": "1-sentence explanation",
      "contextBefore": "preceding words in passage",
      "contextAfter": "following words in passage"
    }
  ]
}`;

  const completion = await withRetry(
    () =>
      client.chat.completions.create(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
        },
        signal ? { signal } : undefined
      ),
    signal
  );

  const raw2 = (() => {
    const content = completion.choices[0]?.message?.content;
    assertNonEmptyContent(content, "requestMinimalEditsForPassage");
    return content;
  })();
  const parsed = await parseJson(raw2, EditsSchema);

  if (!parsed.ok || !parsed.data) {
    return [];
  }

  return parsed.data.edits.map((e) => ({
    target: e.target.trim(),
    replacement: e.replacement.trim(),
    reason: e.reason.trim(),
    contextBefore: e.contextBefore?.trim(),
    contextAfter: e.contextAfter?.trim(),
    passage, // Pass authoritative passage as ground-truth anchor
    targetConcept: e.targetConcept?.trim(),
    expectedOriginal: e.expectedOriginal?.trim() || undefined,
    actualDocumentValue: e.actualTargetInClause?.trim() || undefined,
  }));
}

/**
 * Proposes verified tracked-change redlines for a DOCX document.
 */
export async function proposeRedline(
  documentId: string,
  instruction: string,
  options?: ProposeRedlineOptions
): Promise<ProposeRedlineResponse> {
  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) {
    throw new AppError("VALIDATION", "Instruction must not be empty", 400);
  }

  // 1. Get authoritative DOCX text view
  const { text: docxTextView } = await getDocxTextView(documentId);

  // 2. Scan DOCX text chunks to find candidate passages
  const chunks = chunkDocument(docxTextView);
  const candidatePassages: string[] = [];

  for (const chunk of chunks) {
    const passages = await locatePassagesInChunk(
      chunk.text,
      trimmedInstruction,
      options?.signal
    );
    candidatePassages.push(...passages);
  }

  // 3. Verify passages against the authoritative DOCX text view
  // Deduplicate and verify verbatim inclusion
  const verifiedPassages: string[] = [];
  for (const candidate of candidatePassages) {
    if (docxTextView.includes(candidate)) {
      if (!verifiedPassages.includes(candidate)) {
        verifiedPassages.push(candidate);
      }
    } else {
      // Try normalized spacing check if strict include failed
      const normalizedCandidate = candidate.replace(/\s+/g, " ");
      const normalizedView = docxTextView.replace(/\s+/g, " ");
      const idx = normalizedView.indexOf(normalizedCandidate);
      if (idx !== -1) {
        if (!verifiedPassages.includes(candidate)) {
          verifiedPassages.push(candidate);
        }
      }
    }
  }

  // If no passages found, handle negative result honestly
  if (verifiedPassages.length === 0) {
    const record = await db.redline.create({
      data: {
        documentId,
        instruction: trimmedInstruction,
        edits: [],
        status: "PROPOSED",
      },
    });

    return {
      id: record.id,
      documentId,
      instruction: trimmedInstruction,
      status: "PROPOSED",
      edits: [],
      verifiedEdits: [],
      droppedEdits: [],
      message:
        "No relevant clauses found in the document for this instruction. No edits were proposed.",
      createdAt: record.createdAt.toISOString(),
    };
  }

  // 3b. Deterministically parse user instruction for explicit "from X to Y" source values
  const deterministicIntents = parseInstructionIntents(trimmedInstruction);

  // 4. Request minimal edits for each verified passage
  const rawEdits: RedlineRawEdit[] = [];
  for (const passage of verifiedPassages) {
    const edits = await requestMinimalEditsForPassage(
      passage,
      trimmedInstruction,
      options?.signal
    );

    // If model returned no edits but deterministic intents exist for this clause:
    if (edits.length === 0 && deterministicIntents.length > 0) {
      for (const intent of deterministicIntents) {
        if (intent.expectedOriginal && !clauseContainsValue(passage, intent.expectedOriginal)) {
          const actualVal =
            extractActualValueInClause(passage, intent.expectedOriginal) ||
            "a different value";
          const dropReason = `The specified original value ${intent.expectedOriginal} was not found in the identified clause. The document contains ${actualVal} instead. No change was applied.`;

          rawEdits.push({
            target: intent.expectedOriginal,
            replacement: intent.replacement,
            reason: `Target verification failed for ${intent.expectedOriginal}.`,
            passage,
            expectedOriginal: intent.expectedOriginal,
            actualDocumentValue: actualVal,
            preFailed: true,
            preFailedReason: dropReason,
          });
        }
      }
    }

    for (const edit of edits) {
      // Correlate with deterministic instruction intents
      let expectedOriginal = edit.expectedOriginal;
      if (!expectedOriginal) {
        // Try to match by replacement text or concept
        const matchedIntent = deterministicIntents.find(
          (intent) =>
            intent.expectedOriginal &&
            (normalizeValueForMatch(intent.replacement) === normalizeValueForMatch(edit.replacement) ||
             (intent.targetConcept && edit.targetConcept && intent.targetConcept.toLowerCase() === edit.targetConcept.toLowerCase()))
        );
        if (matchedIntent?.expectedOriginal) {
          expectedOriginal = matchedIntent.expectedOriginal;
        } else if (deterministicIntents.length === 1 && deterministicIntents[0].expectedOriginal) {
          expectedOriginal = deterministicIntents[0].expectedOriginal;
        }
      }

      // PRECONDITION CHECK:
      // If expectedOriginal was specified, it MUST exist in the target passage!
      if (expectedOriginal) {
        const containsExpected = clauseContainsValue(passage, expectedOriginal);
        if (!containsExpected) {
          // The user's specified original value DOES NOT exist in this target clause!
          const actualVal =
            edit.actualDocumentValue ||
            extractActualValueInClause(passage, expectedOriginal) ||
            (passage.includes(edit.target) ? edit.target : "a different value");

          const dropReason = `The specified original value ${expectedOriginal} was not found in the identified clause. The document contains ${actualVal} instead. No change was applied.`;

          rawEdits.push({
            target: expectedOriginal,
            replacement: edit.replacement,
            reason: edit.reason,
            passage,
            expectedOriginal,
            actualDocumentValue: actualVal,
            preFailed: true,
            preFailedReason: dropReason,
            contextBefore: edit.contextBefore,
            contextAfter: edit.contextAfter,
          });
          continue;
        } else {
          // If expectedOriginal IS present in the passage, ensure target is expectedOriginal
          edit.target = expectedOriginal;
          edit.expectedOriginal = expectedOriginal;
          edit.actualDocumentValue = expectedOriginal;
        }
      }

      // RULE: target must be an exact substring of a verified passage
      if (passage.includes(edit.target)) {
        rawEdits.push(edit);
      } else {
        if (docxTextView.includes(edit.target)) {
          rawEdits.push(edit);
        }
      }
    }
  }

  // 5. Verify each target occurs exactly once (verify-edits.ts)
  const verificationResult: VerifyEditsResult = verifyEdits(
    rawEdits,
    docxTextView
  );

  // 6. Save Redline(PROPOSED) to database
  const record = await db.redline.create({
    data: {
      documentId,
      instruction: trimmedInstruction,
      edits: verificationResult.allEdits as any,
      status: "PROPOSED",
    },
  });

  return {
    id: record.id,
    documentId,
    instruction: trimmedInstruction,
    status: "PROPOSED",
    edits: verificationResult.allEdits,
    verifiedEdits: verificationResult.verifiedEdits,
    droppedEdits: verificationResult.droppedEdits,
    message:
      verificationResult.verifiedEdits.length === 0
        ? "Proposed edits could not be verified (targets not found or ambiguous)."
        : undefined,
    createdAt: record.createdAt.toISOString(),
  };
}
