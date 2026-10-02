import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { proposeRedline } from "@/lib/redline/propose";

export const dynamic = "force-dynamic";

const ProposeRedlineSchema = z.object({
  documentId: z.string().min(1, "documentId is required"),
  instruction: z.string().min(1, "instruction is required"),
});

/**
 * POST /api/redlines
 * Proposes tracked-change redlines for a DOCX document.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ProposeRedlineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION",
            message: parsed.error.issues[0]?.message || "Invalid payload",
          },
        },
        { status: 400 }
      );
    }

    const { documentId, instruction } = parsed.data;

    // Verify document exists and is DOCX
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { id: true, name: true, kind: true, status: true },
    });

    if (!doc) {
      return NextResponse.json(
        { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
        { status: 404 }
      );
    }

    if (doc.kind !== "docx") {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_FILE_TYPE",
            message:
              "Tracked-change redlining is only available for DOCX documents. PDFs do not support Word revisions.",
          },
        },
        { status: 400 }
      );
    }

    if (doc.status !== "READY") {
      return NextResponse.json(
        {
          error: {
            code: "DOC_NOT_READY",
            message: `Document is not ready yet (current status: ${doc.status}).`,
          },
        },
        { status: 409 }
      );
    }

    const result = await proposeRedline(documentId, instruction);

    return NextResponse.json({ redline: result }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.httpStatus }
      );
    }
    const message = err instanceof Error ? err.message : "Internal error";
    if (
      message.includes("429") ||
      (err && typeof err === "object" && "status" in err && (err as { status: unknown }).status === 429)
    ) {
      return NextResponse.json(
        {
          error: {
            code: "LLM_RATE_LIMITED",
            message: "Model rate limit exceeded. Please wait a moment and try again.",
          },
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}

/**
 * GET /api/redlines?documentId=...
 * Lists redline sessions for a document.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("documentId");

    const redlines = await db.redline.findMany({
      where: documentId ? { documentId } : undefined,
      select: {
        id: true,
        documentId: true,
        instruction: true,
        status: true,
        edits: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const docIds = Array.from(new Set(redlines.map((r) => r.documentId)));
    const docs = await db.document.findMany({
      where: { id: { in: docIds } },
      select: { id: true, name: true },
    });
    const docMap = new Map(docs.map((d) => [d.id, d.name]));

    const enriched = redlines.map((r) => ({
      ...r,
      documentName: docMap.get(r.documentId) || "Contract.docx",
      outputAvailable: r.status === "APPLIED",
    }));

    return NextResponse.json({
      redlines: enriched,
      sessions: enriched,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: { code: "INTERNAL", message } },
      { status: 500 }
    );
  }
}
