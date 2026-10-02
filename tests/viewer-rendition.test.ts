/**
 * Phase 5 - PDF Viewer, Renditions, and Verified Citation Highlighting (FR-5).
 *
 * Verifies:
 * 1. GET /api/documents/:id/rendition:
 *    - 404 for non-existent document
 *    - 409 for non-ready document
 *    - 200 for PDF document returning original bytes with proper headers
 *    - 206 Partial Content for HTTP Range requests
 *    - 200 for DOCX document returning converted PDF rendition
 * 2. locate API & Viewer Highlight Mapping:
 *    - Multi-line quote returns several rectangles
 *    - Cross-page quote returns linked highlights for both pages
 *    - Repeated quote returns multiple occurrences and allows stepping
 * 3. Client Invariant I-1:
 *    - The client only highlights passages verified by the server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as uploadDoc } from "@/app/api/documents/route";
import { waitForDocument } from "@/lib/jobs/runner";
import { GET as getRendition } from "@/app/api/documents/[id]/rendition/route";
import { GET as locateApi } from "@/app/api/documents/[id]/locate/route";
import { locate } from "@/lib/verify/locate";
import { verifyQuote } from "@/lib/verify/verify-quote";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures");

let pdfDocId = "";
let docxDocId = "";

describe("Phase 5 - PDF Viewer & Citation Highlighting (FR-5)", () => {
  beforeAll(async () => {
    // 1. Upload & wait for a PDF document
    const pdfPath = path.join(fixturesDir, "contract_a.pdf");
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfFormData = new FormData();
    pdfFormData.append(
      "file",
      new Blob([new Uint8Array(pdfBuffer)]),
      "viewer_test_a.pdf"
    );

    const pdfReq = new NextRequest("http://localhost:3000/api/documents", {
      method: "POST",
      body: pdfFormData,
    });
    const pdfRes = await uploadDoc(pdfReq);
    const pdfJson = (await pdfRes.json()) as { id: string };
    pdfDocId = pdfJson.id;
    await waitForDocument(pdfDocId);

    // 2. Upload & wait for a DOCX document
    const docxPath = path.join(fixturesDir, "synthetic_spike_b.docx");
    const docxBuffer = fs.readFileSync(docxPath);
    const docxFormData = new FormData();
    docxFormData.append(
      "file",
      new Blob([new Uint8Array(docxBuffer)]),
      "viewer_test_sample.docx"
    );

    const docxReq = new NextRequest("http://localhost:3000/api/documents", {
      method: "POST",
      body: docxFormData,
    });
    const docxRes = await uploadDoc(docxReq);
    const docxJson = (await docxRes.json()) as { id: string };
    docxDocId = docxJson.id;
    await waitForDocument(docxDocId);
  }, 120000);

  afterAll(async () => {
    if (pdfDocId) {
      await db.document.delete({ where: { id: pdfDocId } }).catch(() => {});
    }
    if (docxDocId) {
      await db.document.delete({ where: { id: docxDocId } }).catch(() => {});
    }
  });

  describe("Task 1: GET /api/documents/:id/rendition", () => {
    it("returns 404 for non-existent document", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/documents/non_existent_id/rendition"
      );
      const res = await getRendition(req, {
        params: { id: "non_existent_id" },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("DOC_NOT_FOUND");
    });

    it("returns 409 if document is not in READY status", async () => {
      const queuedDoc = await db.document.create({
        data: {
          name: "queued.pdf",
          kind: "pdf",
          sizeBytes: 100,
          status: "QUEUED",
        },
      });

      try {
        const req = new NextRequest(
          `http://localhost:3000/api/documents/${queuedDoc.id}/rendition`
        );
        const res = await getRendition(req, { params: { id: queuedDoc.id } });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error.code).toBe("DOC_NOT_READY");
      } finally {
        await db.document.delete({ where: { id: queuedDoc.id } });
      }
    });

    it("returns full original PDF for PDF document with correct headers", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/documents/${pdfDocId}/rendition`
      );
      const res = await getRendition(req, { params: { id: pdfDocId } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(res.headers.get("content-disposition")).toContain("inline");

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const headerStr = new TextDecoder().decode(
        new Uint8Array(arrayBuf.slice(0, 5))
      );
      expect(headerStr).toBe("%PDF-");
    });

    it("supports HTTP Range requests (206 Partial Content)", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/documents/${pdfDocId}/rendition`,
        {
          headers: {
            Range: "bytes=0-100",
          },
        }
      );
      const res = await getRendition(req, { params: { id: pdfDocId } });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-range")).toMatch(/^bytes 0-100\/\d+$/);

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBe(101);
    });

    it("returns 416 for invalid range request where start > end", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/documents/${pdfDocId}/rendition`,
        {
          headers: {
            Range: "bytes=200-100",
          },
        }
      );
      const res = await getRendition(req, { params: { id: pdfDocId } });
      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toContain("bytes */");
    });

    it("returns converted PDF rendition for DOCX document", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/documents/${docxDocId}/rendition`
      );
      const res = await getRendition(req, { params: { id: docxDocId } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toContain(".pdf");

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);
      const headerStr = new TextDecoder().decode(
        new Uint8Array(arrayBuf.slice(0, 5))
      );
      expect(headerStr).toBe("%PDF-");
    });
  });

  describe("Task 3 & 4: Multi-line Quote Locating", () => {
    it("returns several line rectangles for a multi-line clause", async () => {
      const multilineQuote =
        "The Parties acknowledge that this Agreement constitutes the entire agreement between them and supersedes all prior negotiations, representations, and understandings.";
      const vResult = await verifyQuote(multilineQuote, pdfDocId);
      expect(vResult.verified).toBe(true);
      expect(vResult.segments[0].primary).toBeDefined();

      const { start, end, pageStart } = vResult.segments[0].primary!;
      const highlights = await locate(pdfDocId, [{ start, end }]);

      expect(highlights.length).toBeGreaterThan(0);
      const pageHl = highlights.find((h) => h.pageNumber === pageStart);
      expect(pageHl).toBeDefined();
      // A multi-line quote must return several rectangles
      expect(pageHl!.rects.length).toBeGreaterThanOrEqual(2);
      expect(pageHl!.boundingRect).toBeDefined();
      expect(pageHl!.boundingRect.x2).toBeGreaterThan(pageHl!.boundingRect.x1);
      expect(pageHl!.boundingRect.y2).toBeGreaterThan(pageHl!.boundingRect.y1);
    });

    it("can be requested through GET /api/documents/:id/locate", async () => {
      const multilineQuote =
        "The Parties acknowledge that this Agreement constitutes the entire agreement between them and supersedes all prior negotiations, representations, and understandings.";
      const vResult = await verifyQuote(multilineQuote, pdfDocId);
      const { start, end } = vResult.segments[0].primary!;

      const req = new NextRequest(
        `http://localhost:3000/api/documents/${pdfDocId}/locate?ranges=${start}-${end}`
      );
      const res = await locateApi(req, { params: { id: pdfDocId } });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.highlights).toBeInstanceOf(Array);
      expect(json.highlights.length).toBeGreaterThan(0);
      expect(json.highlights[0].rects.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Task 5: Cross-page Quote Locating", () => {
    it("returns linked highlights across multiple pages for a range spanning a page boundary", async () => {
      // Find page 1 and page 2 boundary in documentPage table
      const p1 = await db.documentPage.findUnique({
        where: { documentId_pageNo: { documentId: pdfDocId, pageNo: 1 } },
      });
      const p2 = await db.documentPage.findUnique({
        where: { documentId_pageNo: { documentId: pdfDocId, pageNo: 2 } },
      });

      expect(p1).toBeDefined();
      expect(p2).toBeDefined();

      // Create a range that starts 30 chars before p1 ends and ends 30 chars after p2 starts
      const range = {
        start: Math.max(0, p1!.charEnd - 30),
        end: p2!.charStart + 30,
      };

      const highlights = await locate(pdfDocId, [range]);

      // Must produce highlights on both pages
      const pageNumbers = highlights.map((h) => h.pageNumber);
      expect(pageNumbers).toContain(1);
      expect(pageNumbers).toContain(2);

      // Verify each page's highlight has valid rects and dimensions
      for (const hl of highlights) {
        expect(hl.rects.length).toBeGreaterThan(0);
        expect(hl.width).toBeGreaterThan(0);
        expect(hl.height).toBeGreaterThan(0);
      }
    });
  });

  describe("Task 6: Repeated Quote Locating", () => {
    it("handles multiple occurrences and re-locates selected occurrence", async () => {
      const repeatedPhrase =
        "Time is of the essence in relation to all payment obligations.";
      const vResult = await verifyQuote(repeatedPhrase, pdfDocId);

      expect(vResult.verified).toBe(true);
      expect(vResult.occurrenceCount).toBeGreaterThanOrEqual(2);

      const occs = vResult.segments[0].occurrences;
      expect(occs.length).toBeGreaterThanOrEqual(2);

        // Locating occurrence 0
        const hl0 = await locate(pdfDocId, [
          { start: occs[0].start, end: occs[0].end },
        ]);
        // Locating occurrence 1
        const hl1 = await locate(pdfDocId, [
          { start: occs[1].start, end: occs[1].end },
        ]);

        expect(hl0.length).toBeGreaterThan(0);
        expect(hl1.length).toBeGreaterThan(0);

        // Occurrence 0 and Occurrence 1 must have distinct character offsets
        expect(occs[0].start).not.toBe(occs[1].start);
    });
  });

  describe("Task 10: Invariant I-1 (Verified Source of Truth)", () => {
    it("fails verification for hallucinated quote and cannot be verified", async () => {
      const hallucinated =
        "The vendor shall deliver magical unicorns to the purchaser within five business days.";
      const vResult = await verifyQuote(hallucinated, pdfDocId);
      expect(vResult.verified).toBe(false);
      expect(vResult.failReason).toBe("NOT_FOUND");
      expect(vResult.segments[0].occurrences.length).toBe(0);
    });
  });
});
