import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const SIGNIFICANCE_ORDER: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  COSMETIC: 0,
};

/**
 * GET /api/comparisons/:id
 * Fetches status, metadata, summary, stats, and filtered/sorted changes.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: comparisonId } = await Promise.resolve(params);

    const comparison = await db.comparison.findUnique({
      where: { id: comparisonId },
    });

    if (!comparison) {
      return NextResponse.json(
        { error: "Comparison not found" },
        { status: 404 }
      );
    }

    const [docA, docB] = await Promise.all([
      db.document.findUnique({ where: { id: comparison.docAId }, select: { id: true, name: true, pageCount: true } }),
      db.document.findUnique({ where: { id: comparison.docBId }, select: { id: true, name: true, pageCount: true } }),
    ]);

    // Parse search parameters
    const url = new URL(req.url);
    const significanceParam = url.searchParams.get("significance");
    const typeParam = url.searchParams.get("type");
    const categoryParam = url.searchParams.get("category");
    const sortBy = url.searchParams.get("sortBy") || "order";
    const sortOrder = url.searchParams.get("sortOrder") || (sortBy === "significance" ? "desc" : "asc");

    // Build filter where clause
    const whereClause: any = {
      comparisonId,
    };

    if (significanceParam) {
      const sigs = significanceParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (sigs.length > 0) {
        whereClause.significance = { in: sigs };
      }
    }

    if (typeParam) {
      const types = typeParam
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      if (types.length > 0) {
        whereClause.type = { in: types };
      }
    }

    if (categoryParam) {
      const cats = categoryParam
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (cats.length > 0) {
        whereClause.category = { in: cats };
      }
    }

    let changes = await db.comparisonChange.findMany({
      where: whereClause,
      orderBy: { orderIdx: "asc" },
    });

    // Sort changes
    if (sortBy === "significance") {
      changes.sort((c1, c2) => {
        const r1 = SIGNIFICANCE_ORDER[c1.significance.toUpperCase()] ?? 0;
        const r2 = SIGNIFICANCE_ORDER[c2.significance.toUpperCase()] ?? 0;
        return sortOrder === "desc" ? r2 - r1 : r1 - r2;
      });
    } else {
      if (sortOrder === "desc") {
        changes.sort((c1, c2) => c2.orderIdx - c1.orderIdx);
      } else {
        changes.sort((c1, c2) => c1.orderIdx - c2.orderIdx);
      }
    }

    return NextResponse.json({
      id: comparison.id,
      docA: docA || { id: comparison.docAId, name: "Unknown Document", pageCount: 1 },
      docB: docB || { id: comparison.docBId, name: "Unknown Document", pageCount: 1 },
      status: comparison.status,
      stage: comparison.stage,
      summary: comparison.summary,
      stats: comparison.stats,
      errorMessage: comparison.errorMessage,
      createdAt: comparison.createdAt,
      changes,
    });
  } catch (err: unknown) {
    console.error("[GET /api/comparisons/:id] Error:", err);
    return NextResponse.json(
      { error: "Internal server error occurred while retrieving comparison" },
      { status: 500 }
    );
  }
}
