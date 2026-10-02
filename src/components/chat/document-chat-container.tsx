"use client";

import React, { useState } from "react";
import { ConversationRail, ConversationSummary } from "./conversation-rail";
import { ChatView } from "./chat-view";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import type { ActiveQuoteTarget } from "@/components/viewer/types";
import type { QuoteData } from "./message-item";

interface DocumentChatContainerProps {
  documentId: string;
  documentName: string;
  documentKind: string;
  initialConversations: ConversationSummary[];
  initialActiveConversationId: string;
}

export function DocumentChatContainer({
  documentId,
  documentName,
  documentKind,
  initialConversations,
  initialActiveConversationId,
}: DocumentChatContainerProps) {
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string>(
    initialActiveConversationId
  );
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // Viewer state (Phase 5 FR-5)
  const [activeQuote, setActiveQuote] = useState<ActiveQuoteTarget | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const refreshConversations = async () => {
    try {
      const res = await fetch(`/api/conversations?documentId=${documentId}`);
      if (res.ok) {
        const list = await res.json();
        setConversations(list);
      }
    } catch (err) {
      console.error("Failed to refresh conversations:", err);
    }
  };

  const handleNewChat = async () => {
    if (isCreatingChat) return;
    setIsCreatingChat(true);

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });

      if (!res.ok) throw new Error("Failed to create conversation");
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
            // Automatically create a new one if all were deleted
            await handleNewChat();
          }
        }
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const handleSelectQuote = (quote: QuoteData, occurrenceIndex = 0) => {
    setActiveQuote({
      quoteId: quote.id || quote.ref,
      ref: quote.ref,
      documentId: quote.documentId || documentId,
      documentName: quote.documentName || documentName,
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
      <ConversationRail
        documentId={documentId}
        documentName={documentName}
        documentKind={documentKind}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        isCreatingChat={isCreatingChat}
      />

      {/* Main Chat View */}
      {activeConversationId ? (
        <ChatView
          key={activeConversationId}
          conversationId={activeConversationId}
          documentId={documentId}
          documentName={documentName}
          onConversationUpdated={refreshConversations}
          activeQuoteRef={isViewerOpen ? activeQuote?.ref : null}
          activeOccurrenceIndex={activeQuote?.currentOccurrenceIndex ?? 0}
          onSelectQuote={handleSelectQuote}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
          No conversation selected. Click &quot;New chat&quot; to begin.
        </div>
      )}

      {/* Right Column / Sheet: PDF Viewer with verified citation highlights */}
      {isViewerOpen && (
        <div className="w-[50%] lg:w-[48%] xl:w-[45%] h-full shrink-0 shadow-lg z-30 transition-all duration-200">
          <PdfViewer
            documentId={activeQuote?.documentId || documentId}
            documentName={activeQuote?.documentName || documentName}
            activeQuote={activeQuote}
            onClose={handleCloseViewer}
            onChangeOccurrence={handleChangeOccurrence}
          />
        </div>
      )}
    </div>
  );
}
