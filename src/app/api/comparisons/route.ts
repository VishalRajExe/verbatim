import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueueComparison } from "@/lib/jobs/runner";

const CreateComparisonSchema = z.object({
  docAId: z.string().min(1, "Older document (docAId) is required"),
  docBId: z.string().min(1, "Newer document (docBId) is required"),
  rerun: z.boolean().optional().default(false),
});

/**
 * POST /api/comparisons
 * Enqueues a comparison between two READY documents.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateComparisonSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request payload" },
        { status: 400 }
      );
    }

    const { docAId, docBId, rerun } = parsed.data;

    if (docAId === docBId) {
      return NextResponse.json(
        { error: "Cannot compare a document with itself. Please select two distinct documents." },
        { status: 400 }
      );
    }

    // Verify both documents exist and are READY
    const [docA, docB] = await Promise.all([
      db.document.findUnique({ where: { id: docAId }, select: { id: true, name: true, status: true } }),
      db.document.findUnique({ where: { id: docBId }, select: { id: true, name: true, status: true } }),
    ]);

    if (!docA || !docB) {
      return NextResponse.json(
        { error: "One or both selected documents could not be found." },
        { status: 404 }
      );
    }

    if (docA.status !== "READY" || docB.status !== "READY") {
      return NextResponse.json(
        {
          error: `Both documents must be ready before comparison. Older document: ${docA.status}, Newer document: ${docB.status}.`,
        },
        { status: 400 }
      );
    }

    // Check if an existing comparison exists
    let comparison = await db.comparison.findFirst({
      where: {
        docAId,
        docBId,
      },
      orderBy: { createdAt: "desc" },
    });

    if (comparison && !rerun) {
      // If it's already QUEUED or RUNNING or READY, return it
      if (comparison.status === "QUEUED" || comparison.status === "RUNNING") {
        return NextResponse.json({
          id: comparison.id,
          status: comparison.status,
          stage: comparison.stage,
        });
      }
      if (comparison.status === "READY") {
        return NextResponse.json({
          id: comparison.id,
          status: comparison.status,
          stage: comparison.stage,
          summary: comparison.summary,
          stats: comparison.stats,
        });
      }
    }

    // Create a new comparison
    comparison = await db.comparison.create({
      data: {
        docAId,
        docBId,
        status: "QUEUED",
        stage: "Queued for processing",
      },
    });

    // Enqueue background processing
    enqueueComparison(comparison.id);

    return NextResponse.json(
      {
        id: comparison.id,
        status: comparison.status,
        stage: comparison.stage,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[POST /api/comparisons] Error:", err);
    return NextResponse.json(
      { error: "Internal server error occurred while starting comparison" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/comparisons
 * Lists all comparisons with document details.
 */
export async function GET() {
  try {
    const comparisons = await db.comparison.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        changes: {
          select: { id: true },
        },
      },
      take: 50,
    });

    // Populate document names
    const docIds = new Set<string>();
    for (const c of comparisons) {
      docIds.add(c.docAId);
      docIds.add(c.docBId);
    }

    const docs = await db.document.findMany({
      where: { id: { in: Array.from(docIds) } },
      select: { id: true, name: true },
    });
    const docMap = new Map(docs.map((d) => [d.id, d.name]));

    const result = comparisons.map((c) => ({
      id: c.id,
      docAId: c.docAId,
      docAName: docMap.get(c.docAId) || "Unknown document",
      docBId: c.docBId,
      docBName: docMap.get(c.docBId) || "Unknown document",
      status: c.status,
      stage: c.stage,
      summary: c.summary,
      stats: c.stats,
      changeCount: c.changes.length,
      createdAt: c.createdAt,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[GET /api/comparisons] Error:", err);
    return NextResponse.json(
      { error: "Internal server error occurred while retrieving comparisons" },
      { status: 500 }
    );
  }
}
