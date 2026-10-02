/**
 * Phase 6 — Multi-Document Questions Integration Tests (FR-6).
 *
 * Verifies:
 * 1. Multi-document selection & conversation lifecycle (2 to 5 READY documents).
 * 2. Shared history: multi-document conversations appear in each document's history.
 * 3. Mandatory Security/Logic Test: quote present only in Doc B attributed to Doc A
 *    fails verification with WRONG_DOCUMENT (Rule I-7).
 * 4. Per-document extraction, independent verification, and per-document coverage.
 * 5. Comparative compose prompt and synthesis (similarities, differences, missing provisions).
 * 6. Viewer quote attribution: quotes correctly open and locate within their respective documents.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as uploadDoc } from "@/app/api/documents/route";
import { processDocument } from "@/lib/ingest/pipeline";
import { runQaPipeline } from "@/lib/qa/pipeline";
import { verifyQuote } from "@/lib/verify/verify-quote";
import { parseEvents, StreamEvent } from "@/lib/qa/ndjson-events";
import * as llmClient from "@/lib/llm/client";
import {
  POST as createConv,
  GET as listConvs,
} from "@/app/api/conversations/route";
import { GET as getConv } from "@/app/api/conversations/[id]/route";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures");

let docAId = "";
let docBId = "";
const docAName = "multidoc_contract_a.pdf";
const docBName = "multidoc_contract_b.pdf";

describe("Phase 6 - Multi-Document Questions (FR-6)", () => {
  beforeAll(async () => {
    // 1. Ingest Contract A
    const fileABuf = fs.readFileSync(path.join(fixturesDir, "contract_a.pdf"));
    const formA = new FormData();
    formA.append("file", new Blob([new Uint8Array(fileABuf)]), docAName);
    const resA = await uploadDoc(
      new NextRequest("http://localhost:3000/api/documents", {
        method: "POST",
        body: formA,
      })
    );
    const bodyA = (await resA.json()) as { id: string };
    docAId = bodyA.id;
    await processDocument(docAId);

    // 2. Ingest Contract B
    const fileBBuf = fs.readFileSync(path.join(fixturesDir, "contract_b.pdf"));
    const formB = new FormData();
    formB.append("file", new Blob([new Uint8Array(fileBBuf)]), docBName);
    const resB = await uploadDoc(
      new NextRequest("http://localhost:3000/api/documents", {
        method: "POST",
        body: formB,
      })
    );
    const bodyB = (await resB.json()) as { id: string };
    docBId = bodyB.id;
    await processDocument(docBId);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (docAId) {
      await db.document.delete({ where: { id: docAId } }).catch(() => {});
    }
    if (docBId) {
      await db.document.delete({ where: { id: docBId } }).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Validation & Conversation Lifecycle
  // ---------------------------------------------------------------------------
  it("enforces document count limits (min 2, max 5) and READY status", async () => {
    // A. Less than 2 documents -> 400
    const tooFewReq = new NextRequest("http://localhost:3000/api/conversations", {
      method: "POST",
      body: JSON.stringify({ documentIds: [docAId] }),
    });
    const tooFewRes = await createConv(tooFewReq);
    expect(tooFewRes.status).toBe(400);

    // B. More than 5 documents -> 400
    const tooManyReq = new NextRequest("http://localhost:3000/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        documentIds: [docAId, docBId, "c1", "c2", "c3", "c4"],
      }),
    });
    const tooManyRes = await createConv(tooManyReq);
    expect(tooManyRes.status).toBe(400);

    // C. Non-existent document -> 404
    const notFoundReq = new NextRequest("http://localhost:3000/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        documentIds: [docAId, "non-existent-doc-id"],
      }),
    });
    const notFoundRes = await createConv(notFoundReq);
    expect(notFoundRes.status).toBe(404);

    // D. 2 READY documents -> 201 Created with kind="multi"
    const validReq = new NextRequest("http://localhost:3000/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        documentIds: [docAId, docBId],
        title: "Comparative analysis of Agreement A and B",
      }),
    });
    const validRes = await createConv(validReq);
    expect(validRes.status).toBe(201);
    const conv = (await validRes.json()) as { id: string; kind: string; title: string };
    expect(conv.id).toBeDefined();
    expect(conv.kind).toBe("multi");
  });

  // ---------------------------------------------------------------------------
  // 2. Shared History (FR-6.5)
  // ---------------------------------------------------------------------------
  it("makes multi-document conversation visible in history of each included document", async () => {
    // Create conversation
    const createReq = new NextRequest("http://localhost:3000/api/conversations", {
      method: "POST",
      body: JSON.stringify({
        documentIds: [docAId, docBId],
        title: "Shared History Test",
      }),
    });
    const createRes = await createConv(createReq);
    const conv = (await createRes.json()) as { id: string };

    // Query doc A conversations
    const listAReq = new NextRequest(
      `http://localhost:3000/api/conversations?documentId=${docAId}`
    );
    const listARes = await listConvs(listAReq);
    const listA = (await listARes.json()) as Array<{ id: string; kind?: string }>;
    expect(listA.some((c) => c.id === conv.id)).toBe(true);

    // Query doc B conversations
    const listBReq = new NextRequest(
      `http://localhost:3000/api/conversations?documentId=${docBId}`
    );
    const listBRes = await listConvs(listBReq);
    const listB = (await listBRes.json()) as Array<{ id: string; kind?: string }>;
    expect(listB.some((c) => c.id === conv.id)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. MANDATORY SECURITY / LOGIC TEST (Rule I-7)
  // ---------------------------------------------------------------------------
  it("fails verification with WRONG_DOCUMENT when a quote is present only in Doc B but attributed to Doc A", async () => {
    // Unique sentence that exists in Contract B but NOT in Contract A
    const bOnlySentence =
      "DOCB-UNIQUE: This precise clause appears exclusively in the Software License Agreement and nowhere else in any document.";

    // Ensure Doc B contains this text
    const docBText = await db.documentText.findUnique({
      where: { documentId: docBId },
      select: { text: true },
    });
    expect(docBText?.text).toContain("DOCB-UNIQUE");

    // Attempt verification attributing this passage to Doc A (where it does NOT exist)
    const result = await verifyQuote(bOnlySentence, docAId);

    // Invariant I-7 check
    expect(result.verified).toBe(false);
    expect(result.failReason).toBe("WRONG_DOCUMENT");
  });

  // ---------------------------------------------------------------------------
  // 4. Per-Document Extraction, Verification and Coverage
  // ---------------------------------------------------------------------------
  it("extracts and verifies quotes independently per document with per-document coverage badges", async () => {
    // Create multi-document conversation
    const conv = await db.conversation.create({
      data: {
        title: "Termination Analysis",
        kind: "multi",
        documents: {
          create: [{ documentId: docAId }, { documentId: docBId }],
        },
      },
    });

    const emittedLines: string[] = [];
    const emit = (line: string) => emittedLines.push(line);

    // Mock LLM extract and compose
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: any) => {
            if (!params.stream) {
              // Extract call: return realistic quotes based on the document
              const userMsg = params.messages[1].content as string;
              if (userMsg.includes(docAName)) {
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          quotes: [
                            {
                              text: "This Agreement may be terminated by either party upon thirty (30) days written notice.",
                              why: "States Contract A termination notice period.",
                            },
                          ],
                        }),
                      },
                    },
                  ],
                };
              } else {
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          quotes: [
                            {
                              text: "The License is valid for a period of twelve (12) months from the Effective Date and may be renewed annually.",
                              why: "States Contract B license duration and renewal terms.",
                            },
                          ],
                        }),
                      },
                    },
                  ],
                };
              }
            } else {
              // Streamed compose call
              async function* tokenStream() {
                yield { choices: [{ delta: { content: "Comparing both agreements: " } }] };
                yield { choices: [{ delta: { content: "Contract A permits termination with 30 days notice [Q1], " } }] };
                yield { choices: [{ delta: { content: "whereas Contract B specifies a 12-month term renewable annually [Q2]. " } }] };
                yield { choices: [{ delta: { content: "Contract B lacks an explicit without-cause termination clause." } }] };
              }
              return tokenStream();
            }
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockClient as any);
    vi.spyOn(llmClient, "getLlmModel").mockReturnValue("test-model");

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documents: [
        { id: docAId, name: docAName },
        { id: docBId, name: docBName },
      ],
      question: "How do these two agreements handle termination?",
      signal: new AbortController().signal,
      emit,
    });

    expect(messageId).toBeDefined();

    // Parse all streamed events
    const allEvents: StreamEvent[] = [];
    for (const line of emittedLines) {
      const parsed = parseEvents(line);
      allEvents.push(...parsed.events);
    }

    // 1. Reading events emitted for BOTH documents
    const readingEvents = allEvents.filter(
      (e) => e.type === "status" && (e as any).stage === "reading"
    );
    expect(readingEvents.length).toBeGreaterThanOrEqual(2);
    expect(readingEvents.some((e: any) => e.documentId === docAId)).toBe(true);
    expect(readingEvents.some((e: any) => e.documentId === docBId)).toBe(true);

    // 2. Quotes event: contains verified quotes for both documents with correct attribution
    const quotesEvent = allEvents.find((e) => e.type === "quotes") as any;
    expect(quotesEvent).toBeDefined();
    expect(quotesEvent.quotes.length).toBe(2);

    const q1 = quotesEvent.quotes.find((q: any) => q.ref === "Q1");
    const q2 = quotesEvent.quotes.find((q: any) => q.ref === "Q2");
    expect(q1.verified).toBe(true);
    expect(q1.documentId).toBe(docAId);
    expect(q1.documentName).toBe(docAName);

    expect(q2.verified).toBe(true);
    expect(q2.documentId).toBe(docBId);
    expect(q2.documentName).toBe(docBName);

    // 3. Coverage event: carries coverage for BOTH documents independently
    const coverageEvent = allEvents.find((e) => e.type === "coverage") as any;
    expect(coverageEvent).toBeDefined();
    expect(coverageEvent.coverage.length).toBe(2);
    expect(coverageEvent.coverage[0].documentId).toBe(docAId);
    expect(coverageEvent.coverage[1].documentId).toBe(docBId);
    expect(coverageEvent.coverage[0].complete).toBe(true);
    expect(coverageEvent.coverage[1].complete).toBe(true);

    // 4. Answer token streaming and [Q#] markers
    const tokens = allEvents
      .filter((e) => e.type === "token")
      .map((e: any) => e.text)
      .join("");
    expect(tokens).toContain("[Q1]");
    expect(tokens).toContain("[Q2]");
    expect(tokens).toContain("Contract A");
    expect(tokens).toContain("Contract B");

    // 5. Database check
    const savedMsg = await db.message.findUnique({
      where: { id: messageId },
      include: { quotes: true },
    });
    expect(savedMsg?.status).toBe("COMPLETE");
    expect(savedMsg?.quotes.length).toBe(2);
    expect(savedMsg?.quotes.some((q) => q.documentId === docAId)).toBe(true);
    expect(savedMsg?.quotes.some((q) => q.documentId === docBId)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5. Honest Multi-Document Absence (Rule I-5)
  // ---------------------------------------------------------------------------
  it("handles absence honestly across multiple documents without LLM call", async () => {
    const conv = await db.conversation.create({
      data: {
        title: "Absence Test",
        kind: "multi",
        documents: {
          create: [{ documentId: docAId }, { documentId: docBId }],
        },
      },
    });

    const emittedLines: string[] = [];
    const emit = (line: string) => emittedLines.push(line);

    // Mock LLM extract to return empty quotes array for both documents
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({ quotes: [] }),
                },
              },
            ],
          }),
        },
      },
    };

    vi.spyOn(llmClient, "getLlmClient").mockReturnValue(mockClient as any);
    vi.spyOn(llmClient, "getLlmModel").mockReturnValue("test-model");

    const messageId = await runQaPipeline({
      conversationId: conv.id,
      documents: [
        { id: docAId, name: docAName },
        { id: docBId, name: docBName },
      ],
      question: "What are the rules regarding hazardous chemical disposal?",
      signal: new AbortController().signal,
      emit,
    });

    const allEvents: StreamEvent[] = [];
    for (const line of emittedLines) {
      const parsed = parseEvents(line);
      allEvents.push(...parsed.events);
    }

    const tokenEvent = allEvents.find((e) => e.type === "token") as any;
    expect(tokenEvent).toBeDefined();
    // Fully read all sections across documents -> mentions all documents and read sections
    expect(tokenEvent.text).toContain("couldn't find a passage that answers this in any of the documents");
    expect(tokenEvent.text).toContain(docAName);
    expect(tokenEvent.text).toContain(docBName);

    // Ensure NO compose call was attempted
    expect(allEvents.some((e) => e.type === "status" && (e as any).stage === "composing")).toBe(false);

    const savedMsg = await db.message.findUnique({ where: { id: messageId } });
    expect(savedMsg?.content).toContain("couldn't find a passage that answers this");
  });

  // ---------------------------------------------------------------------------
  // 6. Viewer Location for Multi-Doc Quotes
  // ---------------------------------------------------------------------------
  it("resolves exact geometry for quotes in their respective documents for the viewer", async () => {
    const { GET: getLocate } = await import("@/app/api/documents/[id]/locate/route");
    const { GET: getRendition } = await import("@/app/api/documents/[id]/rendition/route");

    // Locate quote from Doc A
    const quoteA = "This Agreement may be terminated by either party upon thirty (30) days written notice.";
    const verifyA = await verifyQuote(quoteA, docAId);
    expect(verifyA.verified).toBe(true);

    const locateAReq = new NextRequest(
      `http://localhost:3000/api/documents/${docAId}/locate?ranges=${verifyA.canonicalStart}-${verifyA.canonicalEnd}`
    );
    const locateARes = await getLocate(locateAReq, { params: Promise.resolve({ id: docAId }) });
    expect(locateARes.status).toBe(200);
    const locateAData = await locateARes.json();
    expect(locateAData.highlights.length).toBeGreaterThan(0);
    expect(locateAData.highlights[0].rects.length).toBeGreaterThan(0);

    // Rendition for Doc A returns PDF
    const rendARes = await getRendition(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: docAId }),
    });
    expect(rendARes.status).toBe(200);
    expect(rendARes.headers.get("Content-Type")).toBe("application/pdf");

    // Locate quote from Doc B
    const quoteB = "DOCB-UNIQUE: This precise clause appears exclusively in the Software License Agreement and nowhere else in any document.";
    const verifyB = await verifyQuote(quoteB, docBId);
    expect(verifyB.verified).toBe(true);

    const locateBReq = new NextRequest(
      `http://localhost:3000/api/documents/${docBId}/locate?ranges=${verifyB.canonicalStart}-${verifyB.canonicalEnd}`
    );
    const locateBRes = await getLocate(locateBReq, { params: Promise.resolve({ id: docBId }) });
    expect(locateBRes.status).toBe(200);
    const locateBData = await locateBRes.json();
    expect(locateBData.highlights.length).toBeGreaterThan(0);
    expect(locateBData.highlights[0].rects.length).toBeGreaterThan(0);

    // Rendition for Doc B returns PDF
    const rendBRes = await getRendition(new NextRequest("http://localhost:3000"), {
      params: Promise.resolve({ id: docBId }),
    });
    expect(rendBRes.status).toBe(200);
    expect(rendBRes.headers.get("Content-Type")).toBe("application/pdf");
  });
});

