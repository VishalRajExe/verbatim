/**
 * POST /api/conversations/:id/messages — post a question and stream NDJSON answer.
 *
 * Architecture §8 & Rules §9:
 * 1. Creates user message in DB.
 * 2. Streams NDJSON events: status, quotes, coverage, token, done.
 * 3. Supports client abort (signal); stores partial answer on stop (I-4).
 * 4. Never leaks API keys or document text in error messages (I-8, I-9).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { runQaPipeline } from "@/lib/qa/pipeline";
import { encodeEvent } from "@/lib/qa/ndjson-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PostMessageSchema = z.object({
  content: z.string().min(1).optional(),
  question: z.string().min(1).optional(),
}).refine((data) => Boolean(data.content || data.question), {
  message: "Either content or question must be provided.",
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = PostMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: parsed.error.message } },
        { status: 400 }
      );
    }

    const question = (parsed.data.content || parsed.data.question)!.trim();

    // Verify conversation and associated document exist
    const conversation = await db.conversation.findUnique({
      where: { id },
      include: {
        documents: {
          include: {
            document: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversation not found." } },
        { status: 404 }
      );
    }

    const docs = conversation.documents.map((d) => d.document);
    if (docs.length === 0) {
      return NextResponse.json(
        { error: { code: "NO_DOCUMENT", message: "No document attached to conversation." } },
        { status: 400 }
      );
    }

    const notReady = docs.find((d) => d.status !== "READY");
    if (notReady) {
      return NextResponse.json(
        {
          error: {
            code: "DOC_NOT_READY",
            message: `Document "${notReady.name}" is still processing or failed.`,
          },
        },
        { status: 409 }
      );
    }

    // 1. Record user message
    await db.message.create({
      data: {
        conversationId: id,
        role: "user",
        content: question,
        status: "COMPLETE",
      },
    });

    // Touch conversation updated timestamp
    await db.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    // 2. Stream assistant NDJSON response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (line: string) => {
          try {
            controller.enqueue(encoder.encode(line));
          } catch {
            // Controller closed or stream aborted
          }
        };

        try {
          await runQaPipeline({
            conversationId: id,
            documents: docs.map((d) => ({ id: d.id, name: d.name })),
            documentId: docs[0].id,
            documentName: docs[0].name,
            question,
            signal: req.signal,
            emit,
          });
        } catch (err: unknown) {
          if (!req.signal.aborted) {
            const errMsg = err instanceof Error ? err.message : "Pipeline execution failed";
            emit(
              encodeEvent({
                type: "error",
                code: "INTERNAL",
                message: errMsg,
              })
            );
          }
        } finally {
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    console.error("[conversations messages POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Failed to process message." } },
      { status: 500 }
    );
  }
}
