import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { validateUpload } from "@/lib/ingest/validate";
import { enqueueDocument } from "@/lib/jobs/runner";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents
 * Lists all documents using select (never loading BLOBs or full text).
 * Implements Architecture.md section 4/5.
 */
export async function GET() {
  try {
    const documents = await db.document.findMany({
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        status: true,
        stage: true,
        progress: true,
        pageCount: true,
        charCount: true,
        tokenEstimate: true,
        errorCode: true,
        errorMessage: true,
        warnings: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ documents });
  } catch (err: any) {
    console.error("[API] Failed to list documents:", err);
    return NextResponse.json(
      { error: "Failed to list documents" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents
 * Multipart document upload handler.
 * Implements PRD FR-1.1, FR-1.2, FR-1.8.
 * Returns HTTP 202 on valid file; rejects invalid files without storing anything.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file uploaded. Please provide a PDF or DOCX file.", code: "VALIDATION" },
        { status: 400 }
      );
    }

    const filename = (file as any).name || "document";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Strict validation (PRD FR-1.1, FR-1.2, FR-1.8)
    const validated = validateUpload(filename, buffer, file.type);

    // 2. Compute SHA256 checksum
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    // 3. Store Document and DocumentFile in MySQL transaction
    const newDoc = await db.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          name: validated.filename,
          kind: validated.kind,
          sizeBytes: validated.sizeBytes,
          sha256,
          status: "QUEUED",
          stage: "Queued for processing",
          progress: 0,
        },
      });

      await tx.documentFile.create({
        data: {
          documentId: created.id,
          original: buffer,
        },
      });

      return created;
    });

    // 4. Trigger in-process background job
    enqueueDocument(newDoc.id);

    // 5. Respond 202 Accepted immediately
    return NextResponse.json(
      {
        id: newDoc.id,
        name: newDoc.name,
        kind: newDoc.kind,
        sizeBytes: newDoc.sizeBytes,
        status: newDoc.status,
        stage: newDoc.stage,
        progress: newDoc.progress,
      },
      { status: 202 }
    );
  } catch (err: any) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.httpStatus }
      );
    }

    console.error("[API] Upload error:", err);
    return NextResponse.json(
      { error: "Internal server error during upload", code: "INTERNAL" },
      { status: 500 }
    );
  }
}
