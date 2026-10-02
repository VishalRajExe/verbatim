import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { db } from "@/lib/db";
import { DocumentChatContainer } from "@/components/chat/document-chat-container";

export const dynamic = "force-dynamic";

interface DocumentPageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;

  const doc = await db.document.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      stage: true,
      progress: true,
      errorMessage: true,
      file: { select: { rendition: true } },
    },
  });

  if (!doc) {
    notFound();
  }

  // If document is not READY, display its processing or error state
  if (doc.status !== "READY") {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface border border-line rounded-xl p-8 text-center space-y-4 shadow-sm">
          {doc.status === "FAILED" ? (
            <>
              <div className="w-12 h-12 rounded-full bg-danger-soft text-danger flex items-center justify-center mx-auto">
                <AlertCircle size={24} />
              </div>
              <h2 className="font-serif text-lg font-semibold text-ink">
                Document could not be processed
              </h2>
              <p className="text-sm text-ink-muted leading-relaxed">
                {doc.errorMessage || "An error occurred during extraction."}
              </p>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center mx-auto">
                <Loader2 size={24} className="animate-spin" />
              </div>
              <h2 className="font-serif text-lg font-semibold text-ink">
                Document is being processed
              </h2>
              <p className="text-sm text-ink-muted">
                {doc.stage || "Extracting text and calculating page geometry…"} ({doc.progress}%)
              </p>
            </>
          )}

          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent/90 transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Library</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Fetch existing conversations for this document
  const existingConversations = await db.conversation.findMany({
    where: { documents: { some: { documentId: id } } },
    select: {
      id: true,
      title: true,
      kind: true,
      createdAt: true,
      updatedAt: true,
      messages: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  let initialActiveId = existingConversations[0]?.id;
  let summaries = existingConversations.map((c) => ({
    id: c.id,
    title: c.title,
    kind: c.kind,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c.messages.length,
  }));

  // If no conversation exists yet, automatically create the default one
  if (!initialActiveId) {
    const created = await db.conversation.create({
      data: {
        title: `Chat about ${doc.name}`,
        kind: "single",
        documents: { create: { documentId: id } },
      },
      select: { id: true, title: true, createdAt: true },
    });

    initialActiveId = created.id;
    summaries = [
      {
        id: created.id,
        title: created.title,
        kind: "single",
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.createdAt.toISOString(),
        messageCount: 0,
      },
    ];
  }

  return (
    <DocumentChatContainer
      documentId={doc.id}
      documentName={doc.name}
      documentKind={doc.kind}
      initialConversations={summaries}
      initialActiveConversationId={initialActiveId}
      hasPdfRendition={doc.kind === "pdf" || !!doc.file?.rendition}
    />
  );
}
