/**
 * Phase 3 - QA Pipeline and Streaming Chat Integration Tests (FR-2, FR-3).
 *
 * Verifies:
 * 1. Conversation CRUD APIs (POST, GET list, GET single, DELETE).
 * 2. Full QA Pipeline execution with verified quotes and NDJSON event streaming.
 * 3. Deterministic not-found message path when no quotes are extracted (no compose LLM call).
 * 4. Unverified quote isolation (Rules I-3): invented quote is flagged unverified and never passed to compose.
 * 5. Clean abort handling (Rules I-4): stopping mid-stream sets status to STOPPED and persists partial content.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as uploadDoc } from "@/app/api/documents/route";
import { processDocument } from "@/lib/ingest/pipeline";
import { runQaPipeline } from "@/lib/qa/pipeline";
import { parseEvents, StreamEvent } from "@/lib/qa/ndjson-events";
import * as llmClient from "@/lib/llm/client";
import {
  POST as createConv,
  GET as listConvs,
} from "@/app/api/conversations/route";
import {
  GET as getConv,
  DELETE as deleteConv,
} from "@/app/api/conversations/[id]/route";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures");

let testDocId = "";
let testDocName = "chat_test.pdf";

describe("Phase 3 - Chat with One Document (Pipeline & Routes)", () => {
  beforeAll(async () => {
    // Ingest a test document
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

  it("manages conversation lifecycle via API routes", async () => {
    // 1. Create conversation
    const createReq = new NextRequest("http://localhost:3000/api/conversations", {
      method: "POST",
      body: JSON.stringify({ documentId: testDocId, title: "Test Chat" }),
    });
    const createRes = await createConv(createReq);
    expect(createRes.status).toBe(201);
    const conv = (await createRes.json()) as { id: string; title: string };
    expect(conv.id).toBeDefined();
    expect(conv.title).toBe("Test Chat");

    // 2. List conversations for document
    const listReq = new NextRequest(
      `http://localhost:3000/api/conversations?documentId=${testDocId}`
    );
    const listRes = await listConvs(listReq);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list.some((c) => c.id === conv.id)).toBe(true);

    // 3. Get single conversation
    const getRes = await getConv(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: conv.id }),
    });
    expect(getRes.status).toBe(200);
    const single = (await getRes.json()) as { id: string; messages: unknown[] };
    expect(single.id).toBe(conv.id);
    expect(Array.isArray(single.messages)).toBe(true);

    // 4. Delete conversation
    const delRes = await deleteConv(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: conv.id }),
    });
    expect(delRes.status).toBe(204);

    // Verify deleted
    const checkRes = await getConv(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: conv.id }),
    });
    expect(checkRes.status).toBe(404);
  });

  it("runs full QA pipeline: extracts quote, verifies against canonical text, and streams answer with [Q1] citation", async () => {
    // Create a new conversation for this test
    const conv = await db.conversation.create({
      data: {
        title: "Liability test conversation",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const targetQuote =
      "The Parties acknowledge that this Agreement constitutes the entire agreement between them and supersedes all prior negotiations, representations, and understandings.";

    // Mock the LLM client
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (params.stream) {
              // Compose step streaming generator
              async function* streamTokens() {
                yield {
                  choices: [
                    {
                      delta: {
                        content: "According to the contract [Q1], all prior agreements are superseded.",
                      },
                    },
                  ],
                };
              }
              return streamTokens();
            } else {
              // Extract step response
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        quotes: [{ text: targetQuote, why: "entire agreement clause" }],
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
    vi.spyOn(llmClient, "getLlmModel").mockReturnValue("test-model");

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

    expect(messageId).toBeDefined();

    // Parse emitted NDJSON events
    const rawBuffer = emittedLines.join("");
    const { events } = parseEvents(rawBuffer);

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("status");
    expect(eventTypes).toContain("quotes");
    expect(eventTypes).toContain("coverage");
    expect(eventTypes).toContain("token");
    expect(eventTypes).toContain("done");

    // Check quotes event
    const quotesEvent = events.find((e) => e.type === "quotes") as any;
    expect(quotesEvent).toBeDefined();
    expect(quotesEvent.quotes).toHaveLength(1);
    expect(quotesEvent.quotes[0].ref).toBe("Q1");
    expect(quotesEvent.quotes[0].verified).toBe(true);
    expect(quotesEvent.quotes[0].matchKind).toBe("exact");

    // Check coverage event
    const covEvent = events.find((e) => e.type === "coverage") as any;
    expect(covEvent).toBeDefined();
    expect(covEvent.coverage[0].complete).toBe(true);

    // Verify stored Message and Quote rows in database
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
      include: { quotes: true },
    });
    expect(savedMsg).toBeDefined();
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.content).toContain("[Q1]");
    expect(savedMsg?.quotes).toHaveLength(1);
    expect(savedMsg?.quotes[0].ref).toBe("Q1");
    expect(savedMsg?.quotes[0].verified).toBe(true);

    // Cleanup conversation
    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("follows deterministic not-found path without calling compose model when no quotes are extracted", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "Absence test conversation",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const createFn = vi.fn().mockImplementation(async (params: any) => {
      // Extract returns empty quotes
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({ quotes: [] }),
            },
          },
        ],
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
      documentId: testDocId,
      documentName: testDocName,
      question: "What is the penalty for late shipment?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    const rawBuffer = emittedLines.join("");
    const { events } = parseEvents(rawBuffer);

    // Confirm compose step was NEVER called (only 1 extract call was made)
    expect(createFn).toHaveBeenCalledTimes(1);

    // Verify deterministic not found content
    const tokenEvents = events.filter((e) => e.type === "token") as any[];
    const combinedText = tokenEvents.map((t) => t.text).join("");
    expect(combinedText).toContain("couldn't find");

    // Check message in DB
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
      include: { quotes: true },
    });
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.quotes).toHaveLength(0);
    expect(savedMsg?.content).toContain("couldn't find");

    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("isolates unverified invented quotes and prevents them from entering compose (Rules I-3)", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "Invented quote test",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const fakeQuote = "The supplier shall deliver 100 golden statues every Friday.";

    const createFn = vi.fn().mockImplementation(async (params: any) => {
      // Extract returns an invented quote that is NOT in the document
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                quotes: [{ text: fakeQuote, why: "statues clause" }],
              }),
            },
          },
        ],
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
      documentId: testDocId,
      documentName: testDocName,
      question: "Are there any golden statues?",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    const rawBuffer = emittedLines.join("");
    const { events } = parseEvents(rawBuffer);

    // Since verified quotes count was 0 (the quote failed verification), compose was NOT called
    expect(createFn).toHaveBeenCalledTimes(1);

    // Quotes event should show the quote as unverified with failReason
    const quotesEvent = events.find((e) => e.type === "quotes") as any;
    expect(quotesEvent.quotes).toHaveLength(1);
    expect(quotesEvent.quotes[0].verified).toBe(false);
    expect(quotesEvent.quotes[0].failReason).toBe("NOT_FOUND");

    // Check DB Quote row
    const savedQuotes = await db.quote.findMany({
      where: { messageId },
    });
    expect(savedQuotes).toHaveLength(1);
    expect(savedQuotes[0].verified).toBe(false);
    expect(savedQuotes[0].failReason).toBe("NOT_FOUND");

    await db.conversation.delete({ where: { id: conv.id } });
  });

  it("handles abort / stop cleanly and records status as STOPPED with partial text (Rules I-4)", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "Abort test conversation",
        kind: "single",
        documents: { create: { documentId: testDocId } },
      },
    });

    const targetQuote =
      "The Parties acknowledge that this Agreement constitutes the entire agreement between them and supersedes all prior negotiations, representations, and understandings.";

    const controller = new AbortController();

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (params.stream) {
              async function* streamTokens() {
                yield { choices: [{ delta: { content: "First partial chunk. " } }] };
                // Simulate user pressing STOP mid-stream
                controller.abort();
                yield { choices: [{ delta: { content: "This should be discarded." } }] };
              }
              return streamTokens();
            } else {
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

    const emittedLines: string[] = [];

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documentId: testDocId,
      documentName: testDocName,
      question: "Explain the entire agreement clause",
      signal: controller.signal,
      emit: (line) => emittedLines.push(line),
    });

    // Check message in DB
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
    });
    expect(savedMsg?.status).toBe("STOPPED");
    expect(savedMsg?.content).toContain("First partial chunk.");

    await db.conversation.delete({ where: { id: conv.id } });
  });
});
