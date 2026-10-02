import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { POST as postDocument, GET as getDocuments } from "@/app/api/documents/route";
import { GET as getDocument, DELETE as deleteDocument } from "@/app/api/documents/[id]/route";
import { waitForDocument } from "@/lib/jobs/runner";
import { recoverUnfinishedJobs } from "@/lib/jobs/recover";
import { NextRequest } from "next/server";

describe("Phase 1 Ingestion Pipeline & Document Library", () => {
  const fixturesDir = path.resolve(__dirname, "fixtures");
  const createdDocIds: string[] = [];

  afterAll(async () => {
    // Cleanup any test documents
    for (const id of createdDocIds) {
      try {
        await db.document.delete({ where: { id } });
      } catch {
        // ignore
      }
    }
  });

  // Helper to create multipart NextRequest
  function createUploadRequest(filename: string, fileBuffer: Buffer): NextRequest {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)]);
    formData.append("file", blob, filename);

    return new NextRequest("http://localhost:3000/api/documents", {
      method: "POST",
      body: formData,
    });
  }

  // 1. Five-page synthetic PDF with page 5 blank
  it("should upload 5-page PDF, extract canonical text, reach READY, and warn on blank page 5", async () => {
    const pdfPath = path.join(fixturesDir, "synthetic_5page_with_blank.pdf");
    const pdfBuffer = fs.readFileSync(pdfPath);

    const req = createUploadRequest("services_agreement.pdf", pdfBuffer);
    const res = await postDocument(req);
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe("services_agreement.pdf");
    expect(body.status).toBe("QUEUED");
    createdDocIds.push(body.id);

    // Wait for in-process background runner to finish
    await waitForDocument(body.id);

    // Verify document state
    const doc = await db.document.findUnique({
      where: { id: body.id },
      include: {
        text: true,
        pages: { orderBy: { pageNo: "asc" } },
      },
    });

    expect(doc).toBeDefined();
    expect(doc!.status).toBe("READY");
    expect(doc!.stage).toBe("Ready");
    expect(doc!.progress).toBe(100);
    expect(doc!.pageCount).toBe(5);
    expect(doc!.charCount).toBeGreaterThan(200);
    expect(doc!.tokenEstimate).toBeGreaterThan(50);

    // Verify blank page warning (FR-1.5)
    const warnings = doc!.warnings as { emptyPages?: number[] } | null;
    expect(warnings).toBeDefined();
    expect(warnings?.emptyPages).toContain(5);

    // Verify canonical text
    expect(doc!.text).toBeDefined();
    expect(doc!.text!.text).toContain("Confidentiality Obligations");
    expect(doc!.text!.text).toContain("Limitation of Liability");
    expect(doc!.text!.text).toContain("500,000");

    // Verify pages structure
    expect(doc!.pages.length).toBe(5);
    for (const p of doc!.pages) {
      expect(p.charStart).toBeLessThanOrEqual(p.charEnd);
      expect(p.width).toBeGreaterThan(100);
      expect(p.height).toBeGreaterThan(100);
      expect(Array.isArray(p.items)).toBe(true);
    }
  }, 30000);

  // 2. DOCX upload and conversion
  it("should upload DOCX, convert headlessly via LibreOffice, and reach READY", async () => {
    const docxPath = path.join(fixturesDir, "synthetic_spike_b.docx");
    const docxBuffer = fs.readFileSync(docxPath);

    const req = createUploadRequest("contract_v1.docx", docxBuffer);
    const res = await postDocument(req);
    expect(res.status).toBe(202);

    const body = await res.json();
    createdDocIds.push(body.id);

    await waitForDocument(body.id);

    const doc = await db.document.findUnique({
      where: { id: body.id },
      include: { file: true, text: true },
    });

    expect(doc).toBeDefined();
    expect(doc!.kind).toBe("docx");
    expect(doc!.status).toBe("READY");
    expect(doc!.file?.original).toBeDefined();
    expect(doc!.file?.rendition).toBeDefined();
    expect(doc!.file!.rendition!.length).toBeGreaterThan(1000);
    expect(doc!.text?.text).toContain("Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.");
  }, 45000);

  // 3. Scanned PDF (no selectable text)
  it("should fail image-only PDF with NO_TEXT_LAYER and never reach READY", async () => {
    const scannedPath = path.join(fixturesDir, "synthetic_scanned_image.pdf");
    const scannedBuffer = fs.readFileSync(scannedPath);

    const req = createUploadRequest("scanned_receipt.pdf", scannedBuffer);
    const res = await postDocument(req);
    expect(res.status).toBe(202);

    const body = await res.json();
    createdDocIds.push(body.id);

    await waitForDocument(body.id);

    const doc = await db.document.findUnique({
      where: { id: body.id },
    });

    expect(doc).toBeDefined();
    expect(doc!.status).toBe("FAILED");
    expect(doc!.errorCode).toBe("NO_TEXT_LAYER");
    expect(doc!.errorMessage).toBe("no selectable text; OCR is not supported");
    expect(doc!.stage).toBe("Can't read this file");
  }, 30000);

  // 4. Rejections: XLSX, TXT, and renamed EXE
  it("should reject XLSX, TXT, and renamed EXE without storing anything in database", async () => {
    const countBefore = await db.document.count();

    // A. TXT
    const txtReq = createUploadRequest("notes.txt", Buffer.from("Plain text content"));
    const txtRes = await postDocument(txtReq);
    expect(txtRes.status).toBe(415);
    const txtBody = await txtRes.json();
    expect(txtBody.error).toBe("Only PDF and DOCX files are supported.");

    // B. Renamed EXE (starts with MZ)
    const exeBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const exeReq = createUploadRequest("payload.pdf", exeBuf);
    const exeRes = await postDocument(exeReq);
    expect(exeRes.status).toBe(415);
    const exeBody = await exeRes.json();
    expect(exeBody.error).toBe("Only PDF and DOCX files are supported.");

    // C. XLSX
    const xlsxReq = createUploadRequest("data.xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
    const xlsxRes = await postDocument(xlsxReq);
    expect(xlsxRes.status).toBe(415);

    // Verify nothing stored in database
    const countAfter = await db.document.count();
    expect(countAfter).toBe(countBefore);
  });

  // 5. Restart Recovery
  it("should recover unfinished documents on startup and complete processing", async () => {
    const pdfPath = path.join(fixturesDir, "synthetic_spike_a.pdf");
    const pdfBuffer = fs.readFileSync(pdfPath);

    // Manually create an "interrupted" document row stuck in EXTRACTING
    const interruptedDoc = await db.document.create({
      data: {
        name: "interrupted.pdf",
        kind: "pdf",
        sizeBytes: pdfBuffer.length,
        status: "EXTRACTING",
        stage: "Reading page 1 of 1",
        progress: 30,
        file: {
          create: {
            original: pdfBuffer,
          },
        },
      },
    });
    createdDocIds.push(interruptedDoc.id);

    // Run recovery
    const recoveredCount = await recoverUnfinishedJobs();
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    // Wait for the re-queued job to complete
    await waitForDocument(interruptedDoc.id);

    const docAfter = await db.document.findUnique({
      where: { id: interruptedDoc.id },
    });

    expect(docAfter!.status).toBe("READY");
    expect(docAfter!.stage).toBe("Ready");
    expect(docAfter!.progress).toBe(100);
  }, 30000);

  // 6. Cascading Delete
  it("should cascade delete Document, DocumentFile, DocumentText, and DocumentPage", async () => {
    const pdfPath = path.join(fixturesDir, "synthetic_spike_a.pdf");
    const pdfBuffer = fs.readFileSync(pdfPath);

    const req = createUploadRequest("to_delete.pdf", pdfBuffer);
    const res = await postDocument(req);
    const body = await res.json();
    const docId = body.id;

    await waitForDocument(docId);

    // Verify rows exist before delete
    expect(await db.document.count({ where: { id: docId } })).toBe(1);
    expect(await db.documentFile.count({ where: { documentId: docId } })).toBe(1);
    expect(await db.documentText.count({ where: { documentId: docId } })).toBe(1);
    expect(await db.documentPage.count({ where: { documentId: docId } })).toBeGreaterThan(0);

    // Delete via API
    const deleteReq = new NextRequest(`http://localhost:3000/api/documents/${docId}`, {
      method: "DELETE",
    });
    const deleteRes = await deleteDocument(deleteReq, { params: { id: docId } });
    expect(deleteRes.status).toBe(200);

    // Verify complete cascade deletion across MySQL tables
    expect(await db.document.count({ where: { id: docId } })).toBe(0);
    expect(await db.documentFile.count({ where: { documentId: docId } })).toBe(0);
    expect(await db.documentText.count({ where: { documentId: docId } })).toBe(0);
    expect(await db.documentPage.count({ where: { documentId: docId } })).toBe(0);
  }, 30000);
});
