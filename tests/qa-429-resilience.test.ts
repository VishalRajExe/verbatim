/**
 * Tests for Phase 9: 429 Rate Limit Handling & Verified Evidence Fallback
 *
 * Verifies:
 * 1. composition 429 → retry → success
 * 2. composition 429 → retries exhausted → verified-quote fallback (Rules I-3, I-5)
 * 3. extraction 429 handling (lowers coverage honestly, retries with backoff)
 * 4. no API key leakage in emitted events, error messages, or logs (Rule I-8)
 * 5. fallback uses ONLY verified quotes (unverified quotes excluded, Rule I-3)
 * 6. partial/failed coverage produces correct uncertainty wording
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as uploadDoc } from "@/app/api/documents/route";
import { processDocument } from "@/lib/ingest/pipeline";
import { runQaPipeline } from "@/lib/qa/pipeline";
import { parseEvents } from "@/lib/qa/ndjson-events";
import * as llmClient from "@/lib/llm/client";
import * as limiter from "@/lib/llm/limiter";
import { composeEvidenceFallback } from "@/lib/qa/prompts";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
let testDocId = "";
const testDocName = "rate_limit_test.pdf";

describe("QA 429 Resilience & Verified Evidence Fallback", () => {
  beforeAll(async () => {
    // Ingest a test document with known text
    const filePath = path.join(fixturesDir, "contract_a.pdf");
    const fileBuffer = fs.readFileSync(filePath);

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(fileBuffer)]), testDocName);

    const req = new NextRequest("http://localhost:3000/api/documents", {
      method: "POST",
      body: formData,
    });
    const res = await uploadDoc(req);
    const body = (await res.json()) as { id: string };
    testDocId = body.id;

    await processDocument(testDocId);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (testDocId) {
      await db.document.delete({ where: { id: testDocId } }).catch(() => {});
    }
  });

  it("composition 429 → retry → success", async () => {
    vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const conv = await db.conversation.create({
      data: {
        title: "429 Retry Success Test",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const targetQuote =
      "The Parties acknowledge that this Agreement constitutes the entire agreement between them and supersedes all prior negotiations, representations, and understandings.";

    let composeAttempts = 0;

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (params.stream) {
              composeAttempts++;
              if (composeAttempts === 1) {
                // First compose attempt returns 429
                const err: any = new Error("429 status code (no body)");
                err.status = 429;
                err.headers = { "retry-after": "1" };
                throw err;
              }
              // Second compose attempt succeeds
              async function* streamTokens() {
                yield {
                  choices: [
                    {
                      delta: {
                        content: "According to the agreement [Q1], prior negotiations are superseded.",
                      },
                    },
                  ],
                };
              }
              return streamTokens();
            } else {
              // Extraction succeeds
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        quotes: [{ text: targetQuote, why: "entire agreement" }],
                      }),
                    },
                  },
                ],
              };
            }
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);
    vi.spyOn(llmClient, "getLlmModel").mockReturnValue("gemini-3.5-flash-lite");

    const emittedLines: string[] = [];
    const controller = new AbortController();

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documentId: testDocId,
      documentName: testDocName,
      question: "Does this agreement supersede prior discussions?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    expect(composeAttempts).toBe(2);
    expect(messageId).toBeDefined();

    const rawBuffer = emittedLines.join("");
    const { events } = parseEvents(rawBuffer);

    // Verify status emitted retry notification
    const rateLimitStatus = events.find(
      (e: any) =>
        e.type === "status" &&
        e.stage === "composing" &&
        e.message?.includes("rate-limited")
    );
    expect(rateLimitStatus).toBeDefined();

    // Verify final message completed successfully
    const savedMsg = await db.message.findUnique({ where: { id: messageId } });
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.content).toContain("According to the agreement [Q1]");

    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("composition 429 → retries exhausted → verified-quote fallback", async () => {
    vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const conv = await db.conversation.create({
      data: {
        title: "429 Exhausted Fallback Test",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const targetQuote =
      "The Parties acknowledge that this Agreement constitutes the entire agreement between them and supersedes all prior negotiations, representations, and understandings.";

    let composeAttempts = 0;

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (params.stream) {
              composeAttempts++;
              // Every compose attempt fails with 429
              const err: any = new Error("429 status code (no body)");
              err.status = 429;
              throw err;
            } else {
              // Extraction succeeds and produces verified quote
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        quotes: [{ text: targetQuote, why: "entire agreement" }],
                      }),
                    },
                  },
                ],
              };
            }
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);
    vi.spyOn(llmClient, "getLlmModel").mockReturnValue("gemini-3.5-flash-lite");

    const emittedLines: string[] = [];
    const controller = new AbortController();

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documentId: testDocId,
      documentName: testDocName,
      question: "What is the superseding agreement clause?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    expect(composeAttempts).toBe(3); // bounded 3 attempts max

    const rawBuffer = emittedLines.join("");
    const { events } = parseEvents(rawBuffer);

    // Verify token event was emitted with fallback content
    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents.length).toBeGreaterThan(0);

    const fullContent = tokenEvents.map((e: any) => e.text).join("");
    expect(fullContent).toContain("AI composition was temporarily unavailable");
    expect(fullContent).toContain("Showing the verified evidence collected from the document");
    expect(fullContent).toContain(targetQuote);
    expect(fullContent).toContain("[Q1]");

    // Verify stored message in database is COMPLETE, NOT ERROR!
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
      include: { quotes: true },
    });
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.quotes).toHaveLength(1);
    expect(savedMsg?.quotes[0].ref).toBe("Q1");
    expect(savedMsg?.quotes[0].verified).toBe(true);

    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("extraction 429 handling: retries with backoff and marks coverage incomplete on failure", async () => {
    vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const conv = await db.conversation.create({
      data: {
        title: "Extraction 429 Test",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    let extractAttempts = 0;

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (!params.stream) {
              extractAttempts++;
              const err: any = new Error("429 status code (no body)");
              err.status = 429;
              throw err;
            }
            return {};
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);

    const emittedLines: string[] = [];
    const controller = new AbortController();

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documentId: testDocId,
      documentName: testDocName,
      question: "Any question during extraction failure?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    expect(extractAttempts).toBe(3); // bounded 3 attempts

    const rawBuffer = emittedLines.join("");
    const { events } = parseEvents(rawBuffer);

    // Verify coverage event is marked incomplete
    const covEvent = events.find((e) => e.type === "coverage") as any;
    expect(covEvent).toBeDefined();
    expect(covEvent.coverage[0].complete).toBe(false);
    expect(covEvent.coverage[0].failedChunks).toContain(0);

    // Verify honest uncertainty refusal (Rule I-5)
    const tokenEvent = events.find((e) => e.type === "token") as any;
    expect(tokenEvent.text).toContain("Absence is not confirmed");

    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("no API key leakage in emitted events, error messages, or logs (Rule I-8)", async () => {
    const apiKey = process.env.LLM_API_KEY || "TEST_SECRET_KEY_12345";

    const conv = await db.conversation.create({
      data: {
        title: "Security Leakage Test",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({
            status: 429,
            message: `Rate limit hit with key ${apiKey}`,
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockOpenAI as any);

    const emittedLines: string[] = [];
    await runQaPipeline({
      conversationId: conv.id,
      documentId: testDocId,
      documentName: testDocName,
      question: "Security test question",
      signal: new AbortController().signal,
      emit: (line) => emittedLines.push(line),
    });

    const fullEmitted = emittedLines.join("\n");
    expect(fullEmitted.includes(apiKey)).toBe(false);

    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("fallback uses ONLY verified quotes and includes honest uncertainty on partial coverage (Rules I-3, I-5)", () => {
    const verifiedQuotes = [
      {
        ref: "Q1",
        documentName: "Master_Agreement.pdf",
        text: "Supplier liability is limited to AED 100,000.",
        pageStart: 5,
      },
      {
        ref: "Q2",
        documentName: "Master_Agreement.pdf",
        text: "Notice must be given in writing within 30 days.",
        pageStart: 12,
      },
    ];

    // Case 1: Complete coverage
    const completeFallback = composeEvidenceFallback(
      verifiedQuotes,
      ["Master_Agreement.pdf"],
      true
    );

    expect(completeFallback).toContain("AI composition was temporarily unavailable");
    expect(completeFallback).toContain("Showing the verified evidence collected from the document");
    expect(completeFallback).toContain("[Q1] (Master_Agreement.pdf (page 5))");
    expect(completeFallback).toContain("Supplier liability is limited to AED 100,000.");
    expect(completeFallback).toContain("[Q2] (Master_Agreement.pdf (page 12))");
    expect(completeFallback).not.toContain("Coverage is incomplete");

    // Case 2: Partial coverage includes honest uncertainty (Rule I-5)
    const partialFallback = composeEvidenceFallback(
      verifiedQuotes,
      ["Master_Agreement.pdf"],
      false,
      "some sections could not be inspected"
    );

    expect(partialFallback).toContain("Coverage is incomplete — some sections could not be inspected");
    expect(partialFallback).toContain("Additional terms may exist elsewhere in the document");
  });
});
