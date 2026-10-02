import React from "react";
import Link from "next/link";
import { ArrowLeft, Layers, AlertCircle, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { MultiDocChatContainer } from "@/components/chat/multi-doc-chat-container";
import type { ConversationSummary } from "@/components/chat/conversation-rail";

export const dynamic = "force-dynamic";

interface AskPageProps {
  searchParams: Promise<{ docs?: string; conversationId?: string }>;
}

export default async function AskPage({ searchParams }: AskPageProps) {
  const { docs: docsParam, conversationId: convIdParam } = await searchParams;

  // 1. If conversationId is provided, resolve directly
  if (convIdParam) {
    const conversation = await db.conversation.findUnique({
      where: { id: convIdParam },
      include: {
        documents: {
          include: {
            document: {
              select: { id: true, name: true, kind: true, status: true },
            },
          },
        },
      },
    });

    if (conversation && conversation.documents.length >= 2) {
      const docs = conversation.documents.map((d) => d.document);
      const isAnyNotReady = docs.some((d) => d.status !== "READY");

      if (!isAnyNotReady) {
        // Fetch all conversations sharing this primary document
        const existingConvs = await db.conversation.findMany({
          where: { documents: { some: { documentId: docs[0].id } }, kind: "multi" },
          select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            messages: { select: { id: true } },
          },
          orderBy: { updatedAt: "desc" },
        });

        const summaries: ConversationSummary[] = existingConvs.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
          messageCount: c.messages.length,
        }));

        return (
          <MultiDocChatContainer
            documents={docs}
            initialConversationId={conversation.id}
            initialConversations={summaries}
          />
        );
      }
    }
  }

  // 2. If docs param is provided (comma-separated IDs)
  const docIds = docsParam
    ? Array.from(new Set(docsParam.split(",").map((s) => s.trim()).filter(Boolean)))
    : [];

  if (docIds.length >= 2 && docIds.length <= env.MAX_DOCS_PER_QUESTION) {
    const docs = await db.document.findMany({
      where: { id: { in: docIds } },
      select: { id: true, name: true, kind: true, status: true },
    });

    if (docs.length === docIds.length) {
      const notReady = docs.find((d) => d.status !== "READY");
      if (!notReady) {
        // Look for existing multi-doc conversation with these exact documents
        const existingConvs = await db.conversation.findMany({
          where: {
            kind: "multi",
            documents: { some: { documentId: docIds[0] } },
          },
          include: {
            documents: { select: { documentId: true } },
            messages: { select: { id: true } },
          },
          orderBy: { updatedAt: "desc" },
        });

        // Match conversation with exact same documents
        const exactMatch = existingConvs.find((c) => {
          const cIds = new Set(c.documents.map((d) => d.documentId));
          return cIds.size === docIds.length && docIds.every((id) => cIds.has(id));
        });

        let activeId: string;
        let summaries: ConversationSummary[] = existingConvs.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
          messageCount: c.messages.length,
        }));

        if (exactMatch) {
          activeId = exactMatch.id;
        } else {
          // Create new multi-document conversation
          const docNames = docs.map((d) => d.name).join(", ");
          const title =
            docNames.length > 60
              ? `Query across ${docs.length} documents`
              : `Query: ${docNames}`;

          const created = await db.conversation.create({
            data: {
              title,
              kind: "multi",
              documents: {
                create: docIds.map((id) => ({ documentId: id })),
              },
            },
            select: { id: true, title: true, createdAt: true },
          });

          activeId = created.id;
          summaries = [
            {
              id: created.id,
              title: created.title,
              createdAt: created.createdAt.toISOString(),
              updatedAt: created.createdAt.toISOString(),
              messageCount: 0,
            },
            ...summaries,
          ];
        }

        return (
          <MultiDocChatContainer
            documents={docs}
            initialConversationId={activeId}
            initialConversations={summaries}
          />
        );
      }
    }
  }

  // 3. Fallback: Prompt user to select READY documents from Library
  const readyDocs = await db.document.findMany({
    where: { status: "READY" },
    select: { id: true, name: true, kind: true, pageCount: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full bg-surface border border-line rounded-xl p-8 space-y-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
            <Layers size={20} />
          </div>
          <div>
            <h1 className="font-serif text-lg font-bold text-ink">
              Ask Across Documents
            </h1>
            <p className="text-xs text-ink-muted">
              Select 2 to {env.MAX_DOCS_PER_QUESTION} ready contracts to compare terms and synthesize answers.
            </p>
          </div>
        </div>

        {readyDocs.length < 2 ? (
          <div className="rounded-lg bg-caution-soft border border-caution-line p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-caution">
              <AlertCircle size={15} />
              <span>At least 2 ready documents required</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Upload at least 2 contracts in the library and wait for text extraction to finish before running cross-document questions.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-medium text-ink-muted">
              Choose contracts from your library using checkboxes on the library page:
            </div>
            <div className="border border-line rounded-lg divide-y divide-line max-h-60 overflow-y-auto">
              {readyDocs.map((doc) => (
                <div key={doc.id} className="p-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <span
                      className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                        doc.kind === "pdf"
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}
                    >
                      {doc.kind}
                    </span>
                    <span className="font-medium text-ink truncate">{doc.name}</span>
                  </div>
                  {doc.pageCount && (
                    <span className="text-ink-muted font-mono text-[11px] shrink-0">
                      {doc.pageCount}p
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent/90 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Go to Library Selection</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
