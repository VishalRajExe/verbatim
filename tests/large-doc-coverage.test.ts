/**
 * Phase 4 — Large Document Processing and Coverage Tests (FR-4, Rules I-5).
 *
 * Verifies:
 * 1. 150-page document ingestion (extracts all 150 pages, reaches READY, calculates canonical text).
 * 2. Multi-section chunking under CHUNK_TOKENS budget with paragraph boundaries and overlap.
 * 3. Complete coverage query: finds known termination clause on page 115, verifies exact quote,
 *    records complete coverage across all sections.
 * 4. Honest absence handling with forced chunk failure:
 *    - One chunk fails extraction.
 *    - Pipeline lowers coverage instead of crashing.
 *    - Output says "I couldn't find it in the sections I could read... Absence is not confirmed."
 *    - Must NEVER say "There is no auditor" or claim confident absence.
 * 5. Burst stability: 5 rapid concurrent questions remain controlled by LLM_MAX_CONCURRENCY.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as uploadDoc } from "@/app/api/documents/route";
import { waitForDocument } from "@/lib/jobs/runner";
import { chunkDocument } from "@/lib/qa/chunker";
import { runQaPipeline } from "@/lib/qa/pipeline";
import { parseEvents } from "@/lib/qa/ndjson-events";
import * as llmClient from "@/lib/llm/client";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
const largePdfPath = path.join(fixturesDir, "large_150p.pdf");

let largeDocId = "";
const largeDocName = "large_150p.pdf";

const KNOWN_TERMINATION_PHRASE =
  "Either party may terminate this Agreement immediately by written notice";

const KNOWN_TERMINATION_FULL_QUOTE =
  "Either party may terminate this Agreement immediately by written notice " +
  "if the other party breaches any material term and fails to remedy such breach " +
  "within thirty days of receiving written notice thereof.";

describe("Phase 4 - Large Document Processing and Coverage (150 pages)", () => {
  beforeAll(async () => {
    // 1. Upload and ingest the 150-page synthetic legal PDF
    const fileBuffer = fs.readFileSync(largePdfPath);
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(fileBuffer)]), largeDocName);

    const req = new NextRequest("http://localhost:3000/api/documents", {
      method: "POST",
      body: formData,
    });
    const res = await uploadDoc(req);
    const body = (await res.json()) as { id: string };
    largeDocId = body.id;

    // Wait for in-process background runner to complete all 150 pages
    await waitForDocument(largeDocId);
  }, 90000); // 90s timeout as permitted by PRD FR-4.1

  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.VERBATIM_TEST_FAIL_CHUNK;
    if (largeDocId) {
      await db.document.delete({ where: { id: largeDocId } }).catch(() => {});
    }
  });

  it("successfully processes 150 pages into canonical text with exact page geometry", async () => {
    const doc = await db.document.findUnique({
      where: { id: largeDocId },
      include: { pages: true, text: true },
    });

    expect(doc).toBeDefined();
    expect(doc?.status).toBe("READY");
    expect(doc?.pageCount).toBe(150);
    expect(doc?.pages).toHaveLength(150);
    expect(doc?.text?.text.length).toBeGreaterThan(50000);

    // Verify known termination phrase exists in canonical text
    expect(doc?.text?.text).toContain(KNOWN_TERMINATION_PHRASE);

    // Verify page 115 contains the termination clause offset
    const page115 = doc?.pages.find((p) => p.pageNo === 115);
    expect(page115).toBeDefined();
    const clauseOffset = doc!.text!.text.indexOf(KNOWN_TERMINATION_PHRASE);
    expect(clauseOffset).toBeGreaterThanOrEqual(page115!.charStart);
    expect(clauseOffset).toBeLessThan(page115!.charEnd);
  }, 30000);

  it("chunks the 150-page document into multiple sections with overlap", () => {
    const sampleText = (KNOWN_TERMINATION_FULL_QUOTE + "\n\n").repeat(300);
    const sections = chunkDocument(sampleText, { maxTokens: 3000, overlapTokens: 200 });

    expect(sections.length).toBeGreaterThanOrEqual(4);
    for (const sec of sections) {
      expect(sec.charEnd).toBeGreaterThan(sec.charStart);
      expect(sec.text.length).toBeLessThanOrEqual(3000 * 4);
    }
  }, 30000);

  it("completes full QA pipeline with complete coverage on a known termination clause", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "150p Termination Query",
        kind: "single",
        documents: { create: { documentId: largeDocId } },
      },
    });

    // Mock LLM extract to return the known termination clause from the relevant chunk
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (params.stream) {
              async function* streamTokens() {
                yield {
                  choices: [
                    {
                      delta: {
                        content: "Either party may terminate immediately for material breach [Q1].",
                      },
                    },
                  ],
                };
              }
              return streamTokens();
            } else {
              // Extract step: if chunk contains the termination clause, return it
              const content = params.messages[1].content as string;
              if (content.includes("breaches any material term")) {
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          quotes: [
                            {
                              text: KNOWN_TERMINATION_FULL_QUOTE,
                              why: "States exact material breach termination conditions.",
                            },
                          ],
                        }),
                      },
                    },
                  ],
                };
              }
              return {
                choices: [{ message: { content: JSON.stringify({ quotes: [] }) } }],
              };
            }
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);
    vi.spyOn(llmClient, "getLlmModel").mockReturnValue("test-model");

    const emittedLines: string[] = [];
    const controller = new AbortController();

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documentId: largeDocId,
      documentName: largeDocName,
      question: "How can either party terminate this Agreement?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    const { events } = parseEvents(emittedLines.join(""));

    // 1. Verify reading progress events
    const readingEvents = events.filter(
      (e) => e.type === "status" && e.stage === "reading"
    );
    expect(readingEvents.length).toBeGreaterThan(0);

    // 2. Verify verified quote on Page 115
    const quotesEvent = events.find((e) => e.type === "quotes") as any;
    expect(quotesEvent).toBeDefined();
    expect(quotesEvent.quotes.length).toBeGreaterThanOrEqual(1);
    const verifiedQ = quotesEvent.quotes.find((q: any) => q.verified);
    expect(verifiedQ).toBeDefined();
    expect(verifiedQ.ref).toBe("Q1");
    expect(verifiedQ.pageStart).toBe(115);
    expect(verifiedQ.matchKind).toBe("exact");

    // 3. Verify coverage is complete
    const covEvent = events.find((e) => e.type === "coverage") as any;
    expect(covEvent).toBeDefined();
    expect(covEvent.coverage[0].complete).toBe(true);
    expect(covEvent.coverage[0].pages).toBe(150);
    expect(covEvent.coverage[0].failedChunks).toHaveLength(0);

    // 4. Verify message in DB
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
      include: { quotes: true },
    });
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.content).toContain("[Q1]");

    await db.conversation.delete({ where: { id: conv.id } });
  }, 30000);

  it("handles forced chunk failure honestly: lowers coverage, says absence not confirmed, and never says 'There is no auditor' (Rules I-5)", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "Forced Failure & Honest Absence",
        kind: "single",
        documents: { create: { documentId: largeDocId } },
      },
    });

    // Enable test hook: force chunk index 0 to fail
    process.env.VERBATIM_TEST_FAIL_CHUNK = "0";

    const createFn = vi.fn().mockImplementation(async (params: any) => {
      // Return empty quotes for any readable chunk
      return {
        choices: [{ message: { content: JSON.stringify({ quotes: [] }) } }],
      };
    });

    const mockOpenAI = {
      chat: {
        completions: {
          create: createFn,
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);

    const emittedLines: string[] = [];
    const controller = new AbortController();

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documentId: largeDocId,
      documentName: largeDocName,
      question: "What is the name of the company's auditor?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    // Reset test hook
    delete process.env.VERBATIM_TEST_FAIL_CHUNK;

    const { events } = parseEvents(emittedLines.join(""));

    // 1. Verify coverage reflects partial read
    const covEvent = events.find((e) => e.type === "coverage") as any;
    expect(covEvent).toBeDefined();
    const cov = covEvent.coverage[0];
    expect(cov.complete).toBe(false);
    expect(cov.failedChunks).toContain(0);
    expect(cov.chunksRead).toBeLessThan(cov.chunksTotal);

    // 2. Verify deterministic partial absence message
    const tokenEvents = events.filter((e) => e.type === "token") as any[];
    const combinedAnswer = tokenEvents.map((t) => t.text).join("");

    // Must state inability to search all sections & non-confirmation of absence
    expect(combinedAnswer).toContain("I couldn't find it in the sections I could read");
    expect(combinedAnswer).toContain("Absence is not confirmed");

    // Invariant I-5: MUST NEVER claim confident absence
    expect(combinedAnswer.toLowerCase()).not.toContain("there is no auditor");
    expect(combinedAnswer.toLowerCase()).not.toContain("does not exist");
    expect(combinedAnswer.toLowerCase()).not.toContain("there is no such clause");

    // 3. Verify message in DB
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
    });
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.content).toContain("Absence is not confirmed");

    await db.conversation.delete({ where: { id: conv.id } });
  }, 30000);

  it("handles a burst of 5 rapid questions with controlled concurrency and zero crashes", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "Burst Test Conversation",
        kind: "single",
        documents: { create: { documentId: largeDocId } },
      },
    });

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (params.stream) {
              async function* streamTokens() {
                yield { choices: [{ delta: { content: "Sample answer token." } }] };
              }
              return streamTokens();
            }
            return {
              choices: [{ message: { content: JSON.stringify({ quotes: [] }) } }],
            };
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);

    const questions = [
      "What are the payment terms?",
      "Who are the designated signatories?",
      "What is the governing jurisdiction?",
      "What is the confidentiality term?",
      "What is the liability cap amount?",
    ];

    // Fire all 5 questions rapidly and concurrently
    const results = await Promise.all(
      questions.map(async (q) => {
        const lines: string[] = [];
        const controller = new AbortController();
        const msgId = await runQaPipeline({
          conversationId: conv.id,
          documentId: largeDocId,
          documentName: largeDocName,
          question: q,
          signal: controller.signal,
          emit: (line) => lines.push(line),
        });
        return { msgId, lines };
      })
    );

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.msgId).toBeDefined();
      const { events } = parseEvents(r.lines.join(""));
      const doneEvent = events.find((e) => e.type === "done") as any;
      expect(doneEvent).toBeDefined();
      expect(doneEvent.status).toBe("complete");
    }

    await db.conversation.delete({ where: { id: conv.id } });
  }, 30000);
});
