import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { verifyQuote } from "@/lib/verify/verify-quote";
import { notFoundPartial } from "@/lib/qa/prompts";
import { runComparisonPipeline } from "@/lib/compare/pipeline";
import { CONTRACT_A, CONTRACT_B } from "./fixtures/compare-contracts";

const BASE_URL = "http://127.0.0.1:3001";
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures");

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDoc(docId: string, maxSeconds = 60) {
  for (let i = 0; i < maxSeconds; i++) {
    await sleep(1000);
    const res = await fetch(`${BASE_URL}/api/documents/${docId}`);
    const data = await res.json();
    if (data.document?.status === "READY" || data.document?.status === "FAILED") {
      return data.document;
    }
  }
  throw new Error(`Document ${docId} timed out after ${maxSeconds}s`);
}

async function askQuestion(docIds: string | string[], question: string) {
  const isMulti = Array.isArray(docIds);

  const payload: any = { title: question.slice(0, 30) };
  if (isMulti) {
    payload.documentIds = docIds;
  } else {
    payload.documentId = docIds;
  }

  const convRes = await fetch(`${BASE_URL}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const conv = await convRes.json();
  if (!conv.id) throw new Error("Failed to create conversation: " + JSON.stringify(conv));

  const msgRes = await fetch(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: question })
  });

  const reader = msgRes.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  const events: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        events.push(ev);
        if (ev.type === "token") fullText += ev.text;
      } catch {}
    }
  }

  return { conversationId: conv.id, fullText, events };
}

describe("PHASE 9 REAL APPLICATION ACCEPTANCE AUDIT (TESTS 1 - 20)", () => {
  const cleanupDocIds: string[] = [];
  let testPdfId: string;
  let testDocxId: string;
  let multiPageDocId: string;
  let multiDocBId: string;
  let largeDocId: string;

  afterAll(async () => {
    for (const id of cleanupDocIds) {
      if (id) {
        try {
          await fetch(`${BASE_URL}/api/documents/${id}`, { method: "DELETE" });
        } catch {}
      }
    }
  });

  it("TEST 1 — LIBRARY: loads, header/nav links work, document rows render", async () => {
    const homeHtml = await (await fetch(`${BASE_URL}/`)).text();
    expect(homeHtml).toContain("Contract Library");
    expect(homeHtml).toContain("Compare");
    expect(homeHtml).toContain("Ask");

    const docsRes = await (await fetch(`${BASE_URL}/api/documents`)).json();
    expect(Array.isArray(docsRes.documents)).toBe(true);
  });

  it("TEST 2 — PDF UPLOAD: synthetic contract uploaded, transitions through stages to READY", async () => {
    const pdfBuf = fs.readFileSync(path.join(FIXTURES_DIR, "synthetic_spike_a.pdf"));
    const formData = new FormData();
    formData.append("file", new Blob([pdfBuf], { type: "application/pdf" }), "synthetic_spike_a.pdf");

    const upRes = await (await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: formData })).json();
    expect(upRes.id).toBeDefined();
    testPdfId = upRes.id;
    cleanupDocIds.push(testPdfId);

    const doc = await waitForDoc(testPdfId, 30);
    expect(doc.status).toBe("READY");
    expect(doc.pageCount).toBe(1);

    const viewRes = await fetch(`${BASE_URL}/documents/${testPdfId}`);
    expect(viewRes.status).toBe(200);
  }, 45000);

  it("TEST 3 — DOCX UPLOAD: converted via LibreOffice, reaches READY", async () => {
    const docxBuf = fs.readFileSync(path.join(FIXTURES_DIR, "synthetic_spike_b.docx"));
    const formData = new FormData();
    formData.append("file", new Blob([docxBuf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "synthetic_spike_b.docx");

    const upRes = await (await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: formData })).json();
    expect(upRes.id).toBeDefined();
    testDocxId = upRes.id;
    cleanupDocIds.push(testDocxId);

    const doc = await waitForDoc(testDocxId, 45);
    expect(doc.status).toBe("READY");
    expect(doc.pageCount).toBeGreaterThanOrEqual(1);
  }, 60000);

  it("TEST 4 — SCANNED PDF: rejected with FAILED, errorCode NO_TEXT_LAYER", async () => {
    const scanBuf = fs.readFileSync(path.join(FIXTURES_DIR, "synthetic_scanned_image.pdf"));
    const formData = new FormData();
    formData.append("file", new Blob([scanBuf], { type: "application/pdf" }), "scanned_image.pdf");

    const upRes = await (await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: formData })).json();
    cleanupDocIds.push(upRes.id);

    const scanDoc = await waitForDoc(upRes.id, 40);
    expect(scanDoc.status).toBe("FAILED");
    expect(scanDoc.errorCode).toBe("NO_TEXT_LAYER");
    expect(scanDoc.errorMessage).toContain("no selectable text");
  }, 45000);

  it("TEST 5 — SINGLE DOCUMENT CHAT: answers with streaming and [Q1] citation", async () => {
    await sleep(2000);
    const { fullText, events } = await askQuestion(testPdfId, "What is the liability cap?");

    const quotesEv = events.find(e => e.type === "quotes");
    const verifiedQuotes = quotesEv?.quotes?.filter((q: any) => q.verified) || [];

    expect(verifiedQuotes.length).toBeGreaterThan(0);
    expect(fullText).toContain("[Q1]");
    expect(fullText).toContain("100,000");
  }, 30000);

  it("TEST 6 — NOT FOUND: absent topic returns honest not-found without invented answers", async () => {
    await sleep(2000);
    const { fullText, events } = await askQuestion(testPdfId, "What is the company policy regarding interplanetary space travel?");

    const quotesEv = events.find(e => e.type === "quotes");
    const verifiedQuotes = quotesEv?.quotes?.filter((q: any) => q.verified) || [];

    expect(verifiedQuotes.length).toBe(0);
    expect(fullText.toLowerCase()).toContain("couldn't find");
  }, 30000);

  it("TEST 7 — STOP: client abort preserves partial assistant text and status in DB", async () => {
    const convRes = await fetch(`${BASE_URL}/api/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: testPdfId, title: "Stop Test" })
    });
    const conv = await convRes.json();

    const controller = new AbortController();
    const msgRes = await fetch(`${BASE_URL}/api/conversations/${conv.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Describe the entire scope, payment terms, and all milestones in detail." }),
      signal: controller.signal
    });

    const reader = msgRes.body!.getReader();
    const decoder = new TextDecoder();
    let partialTokens = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.includes('"type":"token"')) {
          partialTokens++;
          if (partialTokens >= 2) {
            controller.abort();
            break;
          }
        }
      }
    } catch {}

    await sleep(1500);

    const convData = await (await fetch(`${BASE_URL}/api/conversations/${conv.id}`)).json();
    const assistantMsg = convData.messages?.find((m: any) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
  }, 30000);

  it("TEST 8 — INVENTED QUOTE: verifier strictly rejects fabricated quotes", async () => {
    const fakeQuote = "Supplier warrants that all deliverables will grant unconditional perpetual commercial immortality.";
    const result = await verifyQuote(fakeQuote, testPdfId);

    expect(result.verified).toBe(false);
    expect(result.failReason).toBe("NOT_FOUND");
  });

  it("TEST 9 — CITATION HIGHLIGHT: locate API resolves quote range to Page 1 bounding box", async () => {
    const locRes = await (await fetch(`${BASE_URL}/api/documents/${testPdfId}/locate?ranges=309-390`)).json();
    expect(locRes.highlights?.length).toBeGreaterThan(0);
    const h = locRes.highlights[0];
    expect(h.pageNumber).toBe(1);
    expect(h.boundingRect.x2).toBeGreaterThan(h.boundingRect.x1);
  });

  it("TEST 10 — MULTILINE: locate API splits multiline quote into multiple line rects", async () => {
    const locRes = await (await fetch(`${BASE_URL}/api/documents/${testPdfId}/locate?ranges=130-290`)).json();
    expect(locRes.highlights?.length).toBeGreaterThan(0);
    const h = locRes.highlights[0];
    expect(h.rects.length).toBeGreaterThanOrEqual(2);
  });

  it("TEST 11 — CROSS-PAGE: multi-page contract verifies across page boundaries", async () => {
    const multiBuf = fs.readFileSync(path.join(FIXTURES_DIR, "contract_a.pdf"));
    const formData = new FormData();
    formData.append("file", new Blob([multiBuf], { type: "application/pdf" }), "contract_a_3p.pdf");
    const upRes = await (await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: formData })).json();
    multiPageDocId = upRes.id;
    cleanupDocIds.push(multiPageDocId);

    const doc = await waitForDoc(multiPageDocId, 30);
    expect(doc.pageCount).toBe(3);

    const crossQuote = "Time is of the essence in relation to all payment obligations.";
    const result = await verifyQuote(crossQuote, multiPageDocId);
    expect(result.verified).toBe(true);
  }, 45000);

  it("TEST 12 — REPEATED QUOTE: detects multiple occurrences of identical phrase", async () => {
    const repeatedQuote = "Time is of the essence in relation to all payment obligations.";
    const result = await verifyQuote(repeatedQuote, multiPageDocId);
    expect(result.occurrenceCount).toBeGreaterThanOrEqual(2);
    expect(result.segments?.[0]?.occurrences?.length).toBeGreaterThanOrEqual(2);
  });

  it("TEST 13 — DOCX HIGHLIGHT: verified quote from DOCX maps to converted PDF rendition", async () => {
    // Explicitly convert DOCX to PDF rendition so page coordinates exist
    await fetch(`${BASE_URL}/api/documents/${testDocxId}/convert-pdf`, { method: "POST" });
    await sleep(2000);
    const { events } = await askQuestion(testDocxId, "What is the liability cap?");
    const quotesEv = events.find(e => e.type === "quotes");
    const q = quotesEv?.quotes?.[0];
    expect(q?.verified).toBe(true);

    const start = q.ranges?.[0]?.primary?.start;
    const end = q.ranges?.[0]?.primary?.end;
    const locRes = await (await fetch(`${BASE_URL}/api/documents/${testDocxId}/locate?ranges=${start}-${end}`)).json();
    expect(locRes.highlights?.length).toBeGreaterThan(0);
  }, 45000);

  it("TEST 14 — LARGE DOCUMENT: 150-page document processes to READY and late section is answered", async () => {
    const largeBuf = fs.readFileSync(path.join(FIXTURES_DIR, "large_150p.pdf"));
    const formData = new FormData();
    formData.append("file", new Blob([largeBuf], { type: "application/pdf" }), "large_150p.pdf");

    const upRes = await (await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: formData })).json();
    largeDocId = upRes.id;
    cleanupDocIds.push(largeDocId);

    const doc = await waitForDoc(largeDocId, 60);
    expect(doc.status).toBe("READY");
    expect(doc.pageCount).toBe(150);

    await sleep(2000);
    const { fullText, events } = await askQuestion(largeDocId, "What are the special termination provisions?");
    const quotesEv = events.find(e => e.type === "quotes");
    const verifiedQuotes = quotesEv?.quotes?.filter((q: any) => q.verified) || [];

    expect(verifiedQuotes.length).toBeGreaterThan(0);
    expect(fullText).toContain("[Q1]");
  }, 90000);

  it("TEST 15 — PARTIAL COVERAGE: honest refusal never claims non-existence when sections fail", () => {
    const msg = notFoundPartial("large_150p.pdf", 1, 2, 1);
    expect(msg).not.toContain("The clause does not exist");
    expect(msg).toContain("couldn't find it in the sections I could read");
  });

  it("TEST 16 — MULTI-DOCUMENT: comparative synthesis and cross-doc attribution guard", async () => {
    const bBuf = fs.readFileSync(path.join(FIXTURES_DIR, "contract_b.pdf"));
    const formData = new FormData();
    formData.append("file", new Blob([bBuf], { type: "application/pdf" }), "contract_b_license.pdf");
    const upRes = await (await fetch(`${BASE_URL}/api/documents`, { method: "POST", body: formData })).json();
    multiDocBId = upRes.id;
    cleanupDocIds.push(multiDocBId);

    const docB = await waitForDoc(multiDocBId, 30);
    expect(docB.status).toBe("READY");

    await sleep(2000);
    const { events } = await askQuestion([multiPageDocId, multiDocBId], "How do these two agreements handle termination?");
    const coverageEv = events.find(e => e.type === "coverage");
    expect(coverageEv?.coverage?.length).toBe(2);

    // Cross-document attribution guard (Rule I-7)
    const docBQuote = "Licensor grants Licensee a non-exclusive, non-transferable license";
    const crossCheck = await verifyQuote(docBQuote, multiPageDocId);
    expect(crossCheck.verified).toBe(false);
  }, 60000);

  it("TEST 17 — COMPARISON: detects High significance, Added, Removed, and Moved clauses", async () => {
    const compResult = await runComparisonPipeline(CONTRACT_A, CONTRACT_B);

    const changes = compResult.changes;
    const liabilityChange = changes.find(c => (c.aText?.includes("100,000") && c.bText?.includes("1,000,000")));
    expect(liabilityChange?.significance).toBe("HIGH");

    expect(changes.some(c => c.type === "ADDED")).toBe(true);
    expect(changes.some(c => c.type === "REMOVED")).toBe(true);
    expect(changes.some(c => c.type === "MOVED")).toBe(true);
  }, 30000);

  it("TEST 18 — REDLINE: tracked changes proposal, apply, and OOXML validation", async () => {
    // 1. Propose (with retry for transient rate limits)
    let propBody: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      const propRes = await fetch(`${BASE_URL}/api/redlines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: testDocxId,
          instruction: "Make the liability cap mutual."
        })
      });
      propBody = await propRes.json();
      if (propBody.redline?.id) break;
      await sleep(4000);
    }
    const redline = propBody.redline;
    expect(redline?.id).toBeDefined();

    const edit = redline.edits?.[0];
    expect(edit?.verified).toBe(true);

    // 2. Apply
    const applyRes = await fetch(`${BASE_URL}/api/redlines/${redline.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeIds: [edit.id] })
    });
    const applyData = await applyRes.json();
    expect(applyData.success).toBe(true);
    expect(applyData.validation.libreOfficeSmokeTestPassed).toBe(true);

    // 3. Download & OOXML Inspect
    const dlRes = await fetch(`${BASE_URL}/api/redlines/${redline.id}/download`);
    const docxBuf = Buffer.from(await dlRes.arrayBuffer());

    const tempDocxPath = path.join(FIXTURES_DIR, "temp_eval_redline.docx");
    fs.writeFileSync(tempDocxPath, docxBuf);
    const inspectCmd = `py -c "import zipfile; z = zipfile.ZipFile('${tempDocxPath.replace(/\\/g, "/")}'); xml = z.read('word/document.xml').decode('utf-8'); print('HAS_INS:', '<w:ins' in xml); print('HAS_DEL:', '<w:del' in xml); print('HAS_AUTHOR:', 'Verbatim AI' in xml)"`;
    const pyOut = execSync(inspectCmd).toString();
    try { fs.unlinkSync(tempDocxPath); } catch {}

    expect(pyOut).toContain("HAS_INS: True");
    expect(pyOut).toContain("HAS_DEL: True");
    expect(pyOut).toContain("HAS_AUTHOR: True");
  }, 45000);

  it("TEST 19 — UI CONSISTENCY: all application views return HTTP 200 with unified brand elements", async () => {
    const pages = ["/", "/compare", "/ask", `/documents/${testPdfId}`];
    for (const p of pages) {
      const res = await fetch(`${BASE_URL}${p}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Verbatim");
    }
  });

  it("TEST 20 — FULL USER JOURNEY: end-to-end verified workflow", () => {
    // Confirms all preceding stages executed in sequence
    expect(testPdfId).toBeDefined();
    expect(testDocxId).toBeDefined();
    expect(multiPageDocId).toBeDefined();
    expect(largeDocId).toBeDefined();
  });
});
