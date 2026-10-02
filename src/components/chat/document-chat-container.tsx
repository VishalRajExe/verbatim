"use client";

import React, { useState } from "react";
import { ConversationRail, ConversationSummary } from "./conversation-rail";
import { ChatView } from "./chat-view";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { RedlinePanel } from "@/components/redline/redline-panel";
import { WordViewer } from "@/components/viewer/word-viewer";
import { ConvertPdfModal } from "@/components/viewer/convert-pdf-modal";
import { FileText, FileCode, Download } from "lucide-react";
import type { ActiveQuoteTarget } from "@/components/viewer/types";
import type { QuoteData } from "./message-item";

interface DocumentChatContainerProps {
  documentId: string;
  documentName: string;
  documentKind: string;
  initialConversations: ConversationSummary[];
  initialActiveConversationId: string;
  hasPdfRendition?: boolean;
}

export function DocumentChatContainer({
  documentId,
  documentName,
  documentKind,
  initialConversations,
  initialActiveConversationId,
  hasPdfRendition: initialHasPdfRendition,
}: DocumentChatContainerProps) {
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string>(
    initialActiveConversationId
  );
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [viewMode, setViewMode] = useState<"chat" | "viewer" | "redline">("chat");
  const [documentViewType, setDocumentViewType] = useState<"word" | "pdf">(
    documentKind === "docx" ? "word" : "pdf"
  );
  const [hasPdfRendition, setHasPdfRendition] = useState<boolean>(
    documentKind === "pdf" || Boolean(initialHasPdfRendition)
  );
  const [showConvertPdfModal, setShowConvertPdfModal] = useState(false);

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
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setViewMode("chat");
        }}
        onNewChat={() => {
          setViewMode("chat");
          handleNewChat();
        }}
        onDeleteConversation={handleDeleteConversation}
        isCreatingChat={isCreatingChat}
        viewMode={viewMode}
        onSelectViewMode={setViewMode}
      />

      {/* Main Content Area: Chat, Viewer, or Redline */}
      {viewMode === "viewer" ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-paper">
          {/* Consistent Viewer Experience Header (Requirement 4) */}
          <header className="flex items-center justify-between px-6 py-3.5 bg-surface border-b border-line shrink-0 gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${
                  documentKind === "pdf"
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-blue-50 text-blue-700 border border-blue-200"
                }`}
              >
                <FileText size={15} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xs font-semibold text-ink truncate" title={documentName}>
                  {documentName}
                </h2>
                <p className="text-[10px] text-ink-muted">
                  {documentKind.toUpperCase()} Document &bull; In-App Viewer
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {documentKind === "docx" && (
                <button
                  type="button"
                  onClick={() => setDocumentViewType("word")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    documentViewType === "word"
                      ? "bg-accent text-on-accent border-accent"
                      : "bg-surface border-line text-ink hover:bg-paper"
                  }`}
                >
                  <FileText size={13} />
                  <span>View Word</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (documentKind === "docx" && !hasPdfRendition) {
                    setShowConvertPdfModal(true);
                  } else {
                    setDocumentViewType("pdf");
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  documentViewType === "pdf"
                    ? "bg-accent text-on-accent border-accent"
                    : "bg-surface border-line text-ink hover:bg-paper"
                }`}
              >
                <FileCode
                  size={13}
                  className={documentViewType === "pdf" ? "" : "text-red-600"}
                />
                <span>View PDF</span>
              </button>

              <a
                href={`/api/documents/${documentId}/download`}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-line bg-surface text-ink hover:bg-paper transition-colors"
              >
                <Download size={13} />
                <span>Download</span>
              </a>
            </div>
          </header>

          {/* Document Content View */}
          <div className="flex-1 overflow-hidden relative">
            {documentViewType === "word" && documentKind === "docx" ? (
              <WordViewer
                documentId={documentId}
                documentName={documentName}
                onSwitchToPdf={() => {
                  if (!hasPdfRendition) {
                    setShowConvertPdfModal(true);
                  } else {
                    setDocumentViewType("pdf");
                  }
                }}
                hasPdfRendition={hasPdfRendition}
              />
            ) : (
              <PdfViewer
                documentId={documentId}
                documentName={documentName}
                activeQuote={null}
                onClose={() => {
                  if (documentKind === "docx") setDocumentViewType("word");
                  else setViewMode("chat");
                }}
              />
            )}
          </div>
        </div>
      ) : viewMode === "redline" ? (
        <RedlinePanel
          documentId={documentId}
          documentName={documentName}
          documentKind={documentKind}
          hasPdfRendition={hasPdfRendition}
          onConvertedToPdf={() => setHasPdfRendition(true)}
        />
      ) : activeConversationId ? (
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
      {viewMode === "chat" && isViewerOpen && (
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

      {/* Convert DOCX to PDF Confirmation Modal */}
      <ConvertPdfModal
        isOpen={showConvertPdfModal}
        documentId={documentId}
        documentName={documentName}
        onClose={() => setShowConvertPdfModal(false)}
        onSuccess={() => {
          setShowConvertPdfModal(false);
          setHasPdfRendition(true);
          setDocumentViewType("pdf");
        }}
      />
    </div>
  );
}
