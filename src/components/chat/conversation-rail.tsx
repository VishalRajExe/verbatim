"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Plus, MessageSquare, Trash2 } from "lucide-react";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ConversationRailProps {
  documentId: string;
  documentName: string;
  documentKind: string;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  isCreatingChat?: boolean;
}

export function ConversationRail({
  documentId,
  documentName,
  documentKind,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  isCreatingChat,
}: ConversationRailProps) {
  return (
    <aside className="w-72 border-r border-line bg-surface flex flex-col shrink-0 h-full">
      {/* Top Header */}
      <div className="p-4 border-b border-line space-y-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to Library</span>
        </Link>

        <div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded ${
                documentKind === "pdf"
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}
            >
              {documentKind}
            </span>
            <h2
              className="text-sm font-semibold text-ink truncate"
              title={documentName}
            >
              {documentName}
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={onNewChat}
          disabled={isCreatingChat}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-accent text-on-accent text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          <Plus size={14} />
          <span>New chat</span>
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
          Conversations ({conversations.length})
        </div>

        {conversations.length === 0 ? (
          <div className="p-4 text-center text-xs text-ink-faint">
            No past conversations. Start a new chat above.
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
                onClick={() => onSelectConversation(c.id)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MessageSquare
                    size={14}
                    className={`shrink-0 ${
                      isActive ? "text-accent" : "text-ink-muted"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{c.title || "Contract chat"}</p>
                    <p className="text-[10px] text-ink-faint">
                      {c.messageCount} {c.messageCount === 1 ? "message" : "messages"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this conversation?")) {
                      onDeleteConversation(c.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-ink-muted hover:text-danger rounded transition-opacity"
                  title="Delete conversation"
                  aria-label="Delete conversation"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
