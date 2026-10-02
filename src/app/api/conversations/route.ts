/**
 * POST /api/conversations — create a new conversation for a document.
 * GET  /api/conversations?documentId= — list conversations for a document.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBodySchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: parsed.error.message } },
        { status: 400 }
      );
    }
    const { documentId, title } = parsed.data;

    // Ensure document exists and is READY.
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true, name: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: { code: "DOC_NOT_FOUND", message: "Document not found." } },
        { status: 404 }
      );
    }
    if (doc.status !== "READY") {
      return NextResponse.json(
        {
          error: {
            code: "DOC_NOT_READY",
            message: "Document is still processing. Try again when it's ready.",
          },
        },
        { status: 409 }
      );
    }

    const conversation = await db.conversation.create({
      data: {
        title: title ?? `Chat about ${doc.name}`,
        kind: "single",
        documents: { create: { documentId } },
      },
      select: { id: true, title: true, createdAt: true },
    });

    return NextResponse.json(conversation, { status: 201 });
  } catch (err: unknown) {
    console.error("[conversations POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to create conversation." } },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "documentId is required." } },
        { status: 400 }
      );
    }

    const conversations = await db.conversation.findMany({
      where: { documents: { some: { documentId } } },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          select: { id: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(
      conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
      }))
    );
  } catch (err: unknown) {
    console.error("[conversations GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to load conversations." } },
      { status: 500 }
    );
  }
}
