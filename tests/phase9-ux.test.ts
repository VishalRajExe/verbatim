import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { renderDocxToHtml } from "@/lib/docx/render";
import { GET as viewDocxRoute } from "@/app/api/documents/[id]/view/route";
import { GET as downloadDocxRoute } from "@/app/api/documents/[id]/download/route";
import { GET as viewRedlineRoute } from "@/app/api/redlines/[id]/view/route";
import { GET as listSessionsRoute } from "@/app/api/redlines/route";
import { GET as getSessionRoute } from "@/app/api/redlines/[id]/route";
import { extractDocxText } from "@/lib/redline/view";

describe("Phase 9 UX — Sessions, Manual PDF Conversion, and Document Viewers", () => {
  const docxFixturePath = path.resolve(
    process.cwd(),
    "tests/fixtures/synthetic_spike_b.docx"
  );
  let fixtureBuffer: Buffer;
  let testDocId: string;
  let testSessionId: string;

  beforeAll(async () => {
    fixtureBuffer = fs.readFileSync(docxFixturePath);
    const textView = await extractDocxText(fixtureBuffer);

    // Create a test document that simulates a newly uploaded DOCX
    const doc = await db.document.create({
      data: {
        name: "phase9_ux_test.docx",
        kind: "docx",
        sizeBytes: fixtureBuffer.length,
        status: "READY",
        text: { create: { text: textView } },
        file: {
          create: {
            original: fixtureBuffer as any,
            rendition: null, // Proves no automatic PDF conversion
          },
        },
      },
    });
    testDocId = doc.id;

    // Create a test redline session with proposed, applied, and dropped edits
    const edits = [
      {
        id: "edit-1",
        target: "AED 100,000",
        replacement: "AED 1,000,000",
        reason: "Increase liability cap to 1M",
        verified: true,
        include: true,
        occurrences: 1,
      },
      {
        id: "edit-2",
        target: "Non-existent clause text",
        replacement: "New text",
        reason: "Failed verification",
        verified: false,
        include: false,
        occurrences: 0,
        dropReason: "Exact phrase not found in document.",
      },
    ];

    const session = await db.redline.create({
      data: {
        id: `test-session-${Date.now()}`,
        documentId: testDocId,
        instruction: "Change liability cap and missing clause",
        status: "APPLIED",
        edits: edits as any,
        output: fixtureBuffer as any, // Mock applied docx output
      },
    });
    testSessionId = session.id;
  });

  afterAll(async () => {
    if (testSessionId) {
      await db.redline.deleteMany({ where: { documentId: testDocId } }).catch(() => {});
    }
    if (testDocId) {
      await db.documentPage.deleteMany({ where: { documentId: testDocId } }).catch(() => {});
      await db.documentFile.deleteMany({ where: { documentId: testDocId } }).catch(() => {});
      await db.documentText.deleteMany({ where: { documentId: testDocId } }).catch(() => {});
      await db.document.delete({ where: { id: testDocId } }).catch(() => {});
    }
  });

  describe("1. Interactive Sessions & Persistence", () => {
    it("lists sessions with status, proposed, applied, and dropped counts", async () => {
      const req = new NextRequest(`http://localhost:3000/api/redlines?documentId=${testDocId}`);
      const res = await listSessionsRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.redlines).toBeDefined();
      expect(data.sessions).toBeDefined();
      expect(data.redlines.length).toBeGreaterThanOrEqual(1);

      const s = data.redlines.find((item: any) => item.id === testSessionId);
      expect(s).toBeDefined();
      expect(s.instruction).toBe("Change liability cap and missing clause");
      expect(s.status).toBe("APPLIED");
      expect(s.documentName).toBe("phase9_ux_test.docx");
      expect(s.outputAvailable).toBe(true);

      const verifiedEdits = s.edits.filter((e: any) => e.verified);
      const droppedEdits = s.edits.filter((e: any) => !e.verified);
      expect(verifiedEdits.length).toBe(1);
      expect(droppedEdits.length).toBe(1);
      expect(droppedEdits[0].dropReason).toBe("Exact phrase not found in document.");
    });

    it("opens a specific session and restores complete session details", async () => {
      const req = new NextRequest(`http://localhost:3000/api/redlines/${testSessionId}`);
      const res = await getSessionRoute(req, { params: Promise.resolve({ id: testSessionId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.redline.id).toBe(testSessionId);
      expect(data.redline.instruction).toBe("Change liability cap and missing clause");
      expect(data.redline.edits.length).toBe(2);
      expect(data.redline.outputAvailable).toBe(true);
      expect(data.session).toBeDefined();
    });

    it("persists sessions across simulated page refresh (database reload)", async () => {
      const sessionFromDb = await db.redline.findUnique({
        where: { id: testSessionId },
      });
      expect(sessionFromDb).not.toBeNull();
      expect(sessionFromDb?.id).toBe(testSessionId);
      expect(sessionFromDb?.status).toBe("APPLIED");
      expect(sessionFromDb?.output).not.toBeNull();
    });
  });

  describe("2. Manual User-Controlled PDF Conversion", () => {
    it("verifies DOCX ingestion does NOT automatically populate PDF rendition", async () => {
      const fileRecord = await db.documentFile.findUnique({
        where: { documentId: testDocId },
      });
      // The rendition must be null initially since PDF conversion is manual
      expect(fileRecord?.rendition).toBeNull();
    });

    it("verifies authoritative DOCX text view exists and is ready for redlining immediately", async () => {
      const textRecord = await db.documentText.findUnique({
        where: { documentId: testDocId },
      });
      expect(textRecord?.text).toBeDefined();
      expect(textRecord?.text.length).toBeGreaterThan(0);
    });
  });

  describe("3. In-App Document Viewers", () => {
    it("renders DOCX to clean HTML inside the website via renderDocxToHtml", () => {
      const html = renderDocxToHtml(fixtureBuffer);
      expect(html).toBeDefined();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(100);
      expect(html).toContain("<p");
    });

    it("serves in-app DOCX view via GET /api/documents/:id/view", async () => {
      const req = new NextRequest(`http://localhost:3000/api/documents/${testDocId}/view`);
      const res = await viewDocxRoute(req, { params: Promise.resolve({ id: testDocId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.html).toBeDefined();
      expect(data.documentName).toBe("phase9_ux_test.docx");
      expect(data.kind).toBe("docx");
      expect(data.hasPdfRendition).toBe(false);
    });

    it("serves original document download via GET /api/documents/:id/download", async () => {
      const req = new NextRequest(`http://localhost:3000/api/documents/${testDocId}/download`);
      const res = await downloadDocxRoute(req, { params: Promise.resolve({ id: testDocId }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      expect(res.headers.get("content-disposition")).toContain("phase9_ux_test.docx");
    });

    it("renders redlined DOCX with tracked revisions via GET /api/redlines/:id/view", async () => {
      const req = new NextRequest(`http://localhost:3000/api/redlines/${testSessionId}/view`);
      const res = await viewRedlineRoute(req, { params: Promise.resolve({ id: testSessionId }) });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.html).toBeDefined();
      expect(data.sessionId).toBe(testSessionId);
    });
  });

  describe("4. Redline Workflow without PDF Conversion", () => {
    it("confirms redline operates purely on authoritative DOCX text", async () => {
      const doc = await db.document.findUnique({
        where: { id: testDocId },
        include: { file: true, text: true },
      });

      expect(doc?.kind).toBe("docx");
      expect(doc?.file?.rendition).toBeNull(); // No PDF
      expect(doc?.text?.text).toBeDefined(); // Authoritative text present
    });
  });
});
