import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { applyRedlines } from "@/lib/redline/apply";

export const dynamic = "force-dynamic";

const ApplySchema = z.object({
  includeIds: z.array(z.string()).optional(),
});

/**
 * POST /api/redlines/:id/apply
 * Applies approved redlines to produce a tracked-changes DOCX file.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params);
    const redlineId = resolved.id;

    let includeIds: string[] | undefined;
    try {
      const body = await req.json();
      const parsed = ApplySchema.safeParse(body);
      if (parsed.success) {
        includeIds = parsed.data.includeIds;
      }
    } catch {
      // Empty or non-JSON body is acceptable (defaults to all verified & included edits)
    }

    const result = await applyRedlines(redlineId, { includeIds });

    return NextResponse.json({
      success: true,
      redlineId: result.redlineId,
      status: result.status,
      editsAppliedCount: result.editsAppliedCount,
      validation: {
        valid: result.validation.valid,
        insCount: result.validation.insCount,
        delCount: result.validation.delCount,
        totalRevisions: result.validation.totalRevisions,
        untouchedParagraphsMatched: result.validation.untouchedParagraphsMatched,
        libreOfficeSmokeTestPassed: result.validation.libreOfficeSmokeTestPassed,
      },
    });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.httpStatus }
      );
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}
