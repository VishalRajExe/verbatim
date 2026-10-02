"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, MessageSquare, Layers, Trash2 } from "lucide-react";
import { ChatView } from "./chat-view";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import type { ActiveQuoteTarget } from "@/components/viewer/types";
import type { QuoteData } from "./message-item";
import type { ConversationSummary } from "./conversation-rail";

export interface DocInfo {
  id: string;
  name: string;
  kind: string;
}

interface MultiDocChatContainerProps {
  documents: DocInfo[];
  initialConversationId: string;
  initialConversations: ConversationSummary[];
}

export function MultiDocChatContainer({
  documents,
  initialConversationId,
  initialConversations,
}: MultiDocChatContainerProps) {
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string>(
    initialConversationId
  );
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // Viewer state
  const [activeQuote, setActiveQuote] = useState<ActiveQuoteTarget | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const docIds = documents.map((d) => d.id);

  const refreshConversations = async () => {
    try {
      // Refresh conversations associated with the primary document
      const res = await fetch(`/api/conversations?documentId=${docIds[0]}`);
      if (res.ok) {
        const list: any[] = await res.json();
        // Filter or display multi-doc conversations
        const multiList = list.filter((c) => c.kind === "multi");
        setConversations(
          multiList.length > 0
            ? multiList
            : list.map((c) => ({
                id: c.id,
                title: c.title,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
                messageCount: c.messageCount || 0,
              }))
        );
      }
    } catch (err) {
      console.error("Failed to refresh multi-doc conversations:", err);
    }
  };

  const handleNewChat = async () => {
    if (isCreatingChat) return;
    setIsCreatingChat(true);

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: docIds,
        }),
      });

      if (!res.ok) throw new Error("Failed to create multi-document conversation");
      const created = await res.json();

      const newSummary: ConversationSummary = {
        id: created.id,
        title: created.title,
        createdAt: created.createdAt,
        updatedAt: created.createdAt,
        messageCount: 0,
      };

      setConversations((prev) => [newSummary, ...prev]);
      setActiveConversationId(created.id);
    } catch (err) {
      console.error("Failed to create new conversation:", err);
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const remaining = conversations.filter((c) => c.id !== id);
        setConversations(remaining);

        if (activeConversationId === id) {
          if (remaining.length > 0) {
            setActiveConversationId(remaining[0].id);
          } else {
            await handleNewChat();
          }
        }
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const handleSelectQuote = (quote: QuoteData, occurrenceIndex = 0) => {
    const targetDocId = quote.documentId || docIds[0];
    const targetDocName =
      quote.documentName ||
      documents.find((d) => d.id === targetDocId)?.name ||
      "Document";

    setActiveQuote({
      quoteId: quote.id || quote.ref,
      ref: quote.ref,
      documentId: targetDocId,
      documentName: targetDocName,
      text: quote.text,
      pageStart: quote.pageStart,
      pageEnd: quote.pageEnd,
      occurrences: quote.occurrences || 1,
      ranges: quote.ranges,
      currentOccurrenceIndex: occurrenceIndex,
    });
    setIsViewerOpen(true);
  };

  const handleChangeOccurrence = (newIndex: number) => {
    if (!activeQuote) return;
    setActiveQuote((prev) =>
      prev ? { ...prev, currentOccurrenceIndex: newIndex } : null
    );
  };

  const handleCloseViewer = () => {
    setIsViewerOpen(false);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-paper">
      {/* Left Rail */}
      <aside className="w-72 border-r border-line bg-surface flex flex-col shrink-0 h-full">
        <div className="p-4 border-b border-line space-y-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to Library</span>
          </Link>

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                Multi-Doc
              </span>
              <span className="text-xs text-ink-muted">
                {documents.length} contracts
              </span>
            </div>

            <div className="space-y-1">
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-1.5 text-xs text-ink truncate"
                  title={d.name}
                >
                  <span
                    className={`text-[9px] font-semibold uppercase px-1 rounded shrink-0 ${
                      d.kind === "pdf"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "bg-blue-50 text-blue-700 border border-blue-200"
                    }`}
                  >
                    {d.kind}
                  </span>
                  <span className="truncate">{d.name}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleNewChat}
            disabled={isCreatingChat}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-accent text-on-accent text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            <Plus size={14} />
            <span>New query</span>
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            History ({conversations.length})
          </div>

          {conversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-ink-faint">
              No conversations yet. Ask a question to start.
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConversationId;

              return (
                <div
                  key={c.id}
                  className={`group flex items-center justify-between rounded-md px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                    isActive
                      ? "bg-accent-soft text-accent font-medium"
                      : "text-ink hover:bg-surface-subtle"
                  }`}
                  onClick={() => setActiveConversationId(c.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                    <MessageSquare size={13} className="shrink-0 text-ink-faint" />
                    <span className="truncate" title={c.title}>
                      {c.title}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-ink-faint hover:text-danger rounded transition-opacity"
                    title="Delete conversation"
                    aria-label={`Delete ${c.title}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat View */}
      {activeConversationId ? (
        <ChatView
          key={activeConversationId}
          conversationId={activeConversationId}
          documentId={docIds[0]}
          documentName={documents.map((d) => d.name).join(", ")}
          onConversationUpdated={refreshConversations}
          activeQuoteRef={isViewerOpen ? activeQuote?.ref : null}
          activeOccurrenceIndex={activeQuote?.currentOccurrenceIndex ?? 0}
          onSelectQuote={handleSelectQuote}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
          No conversation selected. Click &quot;New query&quot; to begin.
        </div>
      )}

      {/* Right Column: PDF Viewer with verified citation highlights for the selected document */}
      {isViewerOpen && activeQuote && (
        <div className="w-[50%] lg:w-[48%] xl:w-[45%] h-full shrink-0 shadow-lg z-30 transition-all duration-200">
          <PdfViewer
            documentId={activeQuote.documentId}
            documentName={activeQuote.documentName}
            activeQuote={activeQuote}
            onClose={handleCloseViewer}
            onChangeOccurrence={handleChangeOccurrence}
          />
        </div>
      )}
    </div>
  );
}
