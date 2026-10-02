/**
 * POST /api/conversations — create a new conversation for a document.
 * GET  /api/conversations?documentId= — list conversations for a document.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBodySchema = z
  .object({
    documentId: z.string().min(1).optional(),
    documentIds: z
      .array(z.string().min(1))
      .min(2)
      .max(env.MAX_DOCS_PER_QUESTION)
      .optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .refine(
    (data) =>
      Boolean(
        data.documentId ||
          (data.documentIds && data.documentIds.length >= 2)
      ),
    {
      message:
        "Either documentId or documentIds (2 to 5 documents) must be provided.",
    }
  );

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
    const { documentId, documentIds, title } = parsed.data;

    // 1. Multi-document conversation (FR-6)
    if (documentIds && documentIds.length >= 2) {
      const uniqueIds = Array.from(new Set(documentIds));
      if (uniqueIds.length < 2) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION",
              message: "Please select at least 2 distinct documents.",
            },
          },
          { status: 400 }
        );
      }

      const docs = await db.document.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, status: true, name: true },
      });

      if (docs.length !== uniqueIds.length) {
        return NextResponse.json(
          {
            error: {
              code: "DOC_NOT_FOUND",
              message: "One or more selected documents were not found.",
            },
          },
          { status: 404 }
        );
      }

      const notReady = docs.find((d) => d.status !== "READY");
      if (notReady) {
        return NextResponse.json(
          {
            error: {
              code: "DOC_NOT_READY",
              message: `Document "${notReady.name}" is still processing. Try again when it's ready.`,
            },
          },
          { status: 409 }
        );
      }

      const docNames = docs.map((d) => d.name).join(", ");
      const defaultTitle =
        title ??
        (docNames.length > 60
          ? `Query across ${docs.length} documents`
          : `Query: ${docNames}`);

      const conversation = await db.conversation.create({
        data: {
          title: defaultTitle,
          kind: "multi",
          documents: {
            create: uniqueIds.map((id) => ({ documentId: id })),
          },
        },
        select: { id: true, title: true, kind: true, createdAt: true },
      });

      return NextResponse.json(conversation, { status: 201 });
    }

    // 2. Single-document conversation
    const doc = await db.document.findUnique({
      where: { id: documentId! },
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
        documents: { create: { documentId: documentId! } },
      },
      select: { id: true, title: true, kind: true, createdAt: true },
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
        kind: true,
        createdAt: true,
        updatedAt: true,
        documents: {
          select: {
            document: { select: { id: true, name: true } },
          },
        },
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
        kind: c.kind,
        documents: c.documents.map((d) => d.document),
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
