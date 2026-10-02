/**
 * GET  /api/conversations/:id — fetch a conversation with its messages and quotes.
 * DELETE /api/conversations/:id — delete conversation and cascade.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const conversation = await db.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        kind: true,
        createdAt: true,
        updatedAt: true,
        documents: {
          select: {
            document: { select: { id: true, name: true, status: true } },
          },
        },
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            coverage: true,
            errorMessage: true,
            createdAt: true,
            quotes: {
              select: {
                id: true,
                ref: true,
                documentId: true,
                document: { select: { id: true, name: true } },
                text: true,
                verified: true,
                matchKind: true,
                failReason: true,
                ranges: true,
              },
              orderBy: { ref: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversation not found." } },
        { status: 404 }
      );
    }

    return NextResponse.json(conversation);
  } catch (err: unknown) {
    console.error("[conversation GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to load conversation." } },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const existing = await db.conversation.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversation not found." } },
        { status: 404 }
      );
    }

    await db.conversation.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    console.error("[conversation DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to delete conversation." } },
      { status: 500 }
    );
  }
}
