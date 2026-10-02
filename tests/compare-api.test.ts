import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { POST as createComparison, GET as listComparisons } from "@/app/api/comparisons/route";
import { GET as getComparison } from "@/app/api/comparisons/[id]/route";
import { NextRequest } from "next/server";
import { waitForComparison } from "@/lib/jobs/runner";
import { CONTRACT_A, CONTRACT_B } from "./fixtures/compare-contracts";

describe("Phase 7: Comparison API (/api/comparisons)", () => {
  let docAId: string;
  let docBId: string;
  let comparisonId: string;

  beforeAll(async () => {
    // Create two test documents in READY status
    const docA = await db.document.create({
      data: {
        name: "contract-v1.pdf",
        kind: "pdf",
        sizeBytes: 1024,
        status: "READY",
        pageCount: 2,
      },
    });
    docAId = docA.id;

    await db.documentText.create({
      data: {
        documentId: docAId,
        text: CONTRACT_A,
      },
    });

    const docB = await db.document.create({
      data: {
        name: "contract-v2.pdf",
        kind: "pdf",
        sizeBytes: 1024,
        status: "READY",
        pageCount: 2,
      },
    });
    docBId = docB.id;

    await db.documentText.create({
      data: {
        documentId: docBId,
        text: CONTRACT_B,
      },
    });
  });

  afterAll(async () => {
    if (comparisonId) {
      await db.comparison.deleteMany({ where: { id: comparisonId } });
    }
    if (docAId) {
      await db.document.deleteMany({ where: { id: docAId } });
    }
    if (docBId) {
      await db.document.deleteMany({ where: { id: docBId } });
    }
  });

  it("rejects comparison of identical document IDs", async () => {
    const req = new NextRequest("http://localhost:3000/api/comparisons", {
      method: "POST",
      body: JSON.stringify({ docAId, docBId: docAId }),
    });

    const res = await createComparison(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("distinct");
  });

  it("creates and processes a new comparison between two READY documents", async () => {
    const req = new NextRequest("http://localhost:3000/api/comparisons", {
      method: "POST",
      body: JSON.stringify({ docAId, docBId }),
    });

    const res = await createComparison(req);
    expect([200, 201]).toContain(res.status);
    const data = await res.json();
    expect(data.id).toBeDefined();
    comparisonId = data.id;

    // Wait for the background comparison runner to finish
    await waitForComparison(comparisonId);

    // Fetch the finished comparison
    const compRecord = await db.comparison.findUnique({
      where: { id: comparisonId },
      include: { changes: true },
    });

    expect(compRecord?.status).toBe("READY");
    expect(compRecord?.changes.length).toBeGreaterThan(0);
    expect(compRecord?.summary).toBeTruthy();
  }, 30000);

  it("lists comparisons via GET /api/comparisons", async () => {
    const res = await listComparisons();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const match = data.find((c: any) => c.id === comparisonId);
    expect(match).toBeDefined();
    expect(match.docAName).toBe("contract-v1.pdf");
    expect(match.docBName).toBe("contract-v2.pdf");
  });

  it("supports filtering by significance and type in GET /api/comparisons/:id", async () => {
    // Filter by HIGH significance only
    const reqHigh = new NextRequest(`http://localhost:3000/api/comparisons/${comparisonId}?significance=HIGH`);
    const resHigh = await getComparison(reqHigh, { params: { id: comparisonId } });
    expect(resHigh.status).toBe(200);
    const dataHigh = await resHigh.json();
    expect(dataHigh.changes.length).toBeGreaterThan(0);
    for (const ch of dataHigh.changes) {
      expect(ch.significance).toBe("HIGH");
    }

    // Filter by type=MOVED
    const reqMoved = new NextRequest(`http://localhost:3000/api/comparisons/${comparisonId}?type=MOVED`);
    const resMoved = await getComparison(reqMoved, { params: { id: comparisonId } });
    expect(resMoved.status).toBe(200);
    const dataMoved = await resMoved.json();
    expect(dataMoved.changes.length).toBe(1);
    expect(dataMoved.changes[0].type).toBe("MOVED");
  });

  it("supports sorting by significance descending in GET /api/comparisons/:id", async () => {
    const req = new NextRequest(`http://localhost:3000/api/comparisons/${comparisonId}?sortBy=significance&sortOrder=desc`);
    const res = await getComparison(req, { params: { id: comparisonId } });
    expect(res.status).toBe(200);
    const data = await res.json();

    const sigRanks: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, COSMETIC: 0 };
    for (let i = 0; i < data.changes.length - 1; i++) {
      const r1 = sigRanks[data.changes[i].significance] ?? 0;
      const r2 = sigRanks[data.changes[i + 1].significance] ?? 0;
      expect(r1).toBeGreaterThanOrEqual(r2);
    }
  });
});
