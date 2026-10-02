import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { POST as proposeRoute } from "@/app/api/redlines/route";
import { POST as applyRoute } from "@/app/api/redlines/[id]/apply/route";
import { GET as downloadRoute } from "@/app/api/redlines/[id]/download/route";
import { NextRequest } from "next/server";
import { unzipSync } from "fflate";
import { extractDocxText } from "@/lib/redline/view";
import { getLlmClient } from "@/lib/llm/client";

describe("Phase 8 Redline API Route Tests", () => {
  const docxFixturePath = path.resolve(
    process.cwd(),
    "tests/fixtures/synthetic_spike_b.docx"
  );
  let fixtureBuffer: Buffer;
  let docxDocId: string;
  let pdfDocId: string;

  beforeAll(async () => {
    fixtureBuffer = fs.readFileSync(docxFixturePath);
    const textView = await extractDocxText(fixtureBuffer);

    const docxDoc = await db.document.create({
      data: {
        name: "api_test_contract.docx",
        kind: "docx",
        sizeBytes: fixtureBuffer.length,
        status: "READY",
        text: { create: { text: textView } },
        file: { create: { original: fixtureBuffer as any } },
      },
    });
    docxDocId = docxDoc.id;

    const pdfDoc = await db.document.create({
      data: {
        name: "api_test_contract.pdf",
        kind: "pdf",
        sizeBytes: 2048,
        status: "READY",
      },
    });
    pdfDocId = pdfDoc.id;
  });

  afterAll(async () => {
    if (docxDocId) {
      await db.redline.deleteMany({ where: { documentId: docxDocId } });
      await db.document.delete({ where: { id: docxDocId } }).catch(() => {});
    }
    if (pdfDocId) {
      await db.document.delete({ where: { id: pdfDocId } }).catch(() => {});
    }
  });

  beforeEach(() => {
    vi.spyOn(getLlmClient().chat.completions, "create" as any).mockImplementation(
      async (params: any) => {
        const prompt = params.messages[0].content as string;
        if (prompt.includes("Make the liability cap mutual.")) {
          if (
            prompt.includes(
              "Identify any specific sentence or passage in this excerpt"
            )
          ) {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      passages: [
                        "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.",
                      ],
                    }),
                  },
                },
              ],
            } as any;
          } else {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      edits: [
                        {
                          target: "Supplier's aggregate liability",
                          replacement: "The aggregate liability of either party",
                          reason:
                            "Make the liability cap apply mutually to both parties.",
                        },
                      ],
                    }),
                  },
                },
              ],
            } as any;
          }
        } else if (prompt.includes("termination notice period")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    passages: [],
                  }),
                },
              },
            ],
          } as any;
        }

        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ passages: [], edits: [] }),
              },
            },
          ],
        } as any;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/redlines rejects PDF documents with honest 400 error", async () => {
    const req = new NextRequest("http://localhost:3000/api/redlines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: pdfDocId,
        instruction: "Make the liability cap mutual.",
      }),
    });

    const res = await proposeRoute(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("INVALID_FILE_TYPE");
    expect(data.error.message).toContain(
      "Tracked-change redlining is only available for DOCX documents"
    );
  });

  it(
    "propose → apply → download flow creates valid tracked-changes DOCX",
    async () => {
      // 1. Propose redline with LLM pipeline
      const req = new NextRequest("http://localhost:3000/api/redlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: docxDocId,
          instruction: "Make the liability cap mutual.",
        }),
      });

      const res = await proposeRoute(req);
      const data = await res.json();
      expect(res.status).toBe(201);
      expect(data.redline).toBeDefined();
      expect(data.redline.id).toBeTruthy();
      expect(data.redline.status).toBe("PROPOSED");
      expect(data.redline.edits.length).toBeGreaterThanOrEqual(1);

      const redlineId = data.redline.id;
      const verifiedEdits = data.redline.verifiedEdits;
      expect(verifiedEdits.length).toBeGreaterThanOrEqual(1);

      // 2. Apply redline
      const applyReq = new NextRequest(
        `http://localhost:3000/api/redlines/${redlineId}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            includeIds: verifiedEdits.map((e: any) => e.id),
          }),
        }
      );

      const applyRes = await applyRoute(applyReq, {
        params: Promise.resolve({ id: redlineId }),
      });
      expect(applyRes.status).toBe(200);

      const applyData = await applyRes.json();
      expect(applyData.success).toBe(true);
      expect(applyData.status).toBe("APPLIED");
      expect(applyData.validation.valid).toBe(true);
      expect(applyData.validation.insCount).toBeGreaterThanOrEqual(1);
      expect(applyData.validation.delCount).toBeGreaterThanOrEqual(1);
      expect(applyData.validation.libreOfficeSmokeTestPassed).toBe(true);

      // 3. Download modified DOCX
      const downloadReq = new NextRequest(
        `http://localhost:3000/api/redlines/${redlineId}/download`,
        { method: "GET" }
      );

      const downloadRes = await downloadRoute(downloadReq, {
        params: Promise.resolve({ id: redlineId }),
      });
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("Content-Type")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      expect(downloadRes.headers.get("Content-Disposition")).toContain(
        "attachment; filename="
      );

      const arrayBuf = await downloadRes.arrayBuffer();
      const downloadedBytes = Buffer.from(arrayBuf);
      expect(downloadedBytes.length).toBeGreaterThan(0);

      // Verify tracked changes inside downloaded DOCX
      const unzipped = unzipSync(new Uint8Array(downloadedBytes));
      const docXml = Buffer.from(unzipped["word/document.xml"]).toString("utf-8");
      expect(docXml).toContain("<w:ins");
      expect(docXml).toContain("<w:del");
      expect(docXml).toContain('w:author="Verbatim AI"');
    },
    60000
  );

  it("negative test: instruction for nonexistent concept produces clear message and no file", async () => {
    const req = new NextRequest("http://localhost:3000/api/redlines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: docxDocId,
        instruction: "Change the termination notice period from 30 days to 90 days.",
      }),
    });

    const res = await proposeRoute(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.redline.status).toBe("PROPOSED");
    expect(data.redline.verifiedEdits.length).toBe(0);
    expect(data.redline.message).toBeTruthy();

    const redlineId = data.redline.id;

    // Attempting to apply should fail because no edits exist
    const applyReq = new NextRequest(
      `http://localhost:3000/api/redlines/${redlineId}/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeIds: [] }),
      }
    );

    const applyRes = await applyRoute(applyReq, {
      params: Promise.resolve({ id: redlineId }),
    });
    expect(applyRes.status).toBe(400);

    // Download should fail because not applied
    const downloadReq = new NextRequest(
      `http://localhost:3000/api/redlines/${redlineId}/download`,
      { method: "GET" }
    );
    const downloadRes = await downloadRoute(downloadReq, {
      params: Promise.resolve({ id: redlineId }),
    });
    expect(downloadRes.status).toBe(400);
  }, 45000);
});
