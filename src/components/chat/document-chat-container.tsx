"use client";

import React, { useState } from "react";
import { ConversationRail, ConversationSummary } from "./conversation-rail";
import { ChatView } from "./chat-view";

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
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
          No conversation selected. Click &quot;New chat&quot; to begin.
        </div>
      )}
    </div>
  );
}
