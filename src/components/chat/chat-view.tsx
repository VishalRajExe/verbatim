"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, Square, AlertCircle, Loader2 } from "lucide-react";
import { MessageItem, MessageData, QuoteData } from "./message-item";
import type { CoverageDoc } from "@/lib/qa/coverage";
import { parseEvents } from "@/lib/qa/ndjson-events";

interface ChatViewProps {
  conversationId: string;
  documentId: string;
  documentName: string;
  onConversationUpdated?: () => void;
  activeQuoteRef?: string | null;
  activeOccurrenceIndex?: number;
  onSelectQuote?: (quote: QuoteData, occurrenceIndex?: number) => void;
}

export function ChatView({
  conversationId,
  documentId,
  documentName,
  onConversationUpdated,
  activeQuoteRef: propActiveQuoteRef,
  activeOccurrenceIndex = 0,
  onSelectQuote,
}: ChatViewProps) {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [localActiveQuoteRef, setLocalActiveQuoteRef] = useState<string | null>(null);

  const activeQuoteRef = propActiveQuoteRef !== undefined ? propActiveQuoteRef : localActiveQuoteRef;
  const setActiveQuoteRef = (ref: string | null) => setLocalActiveQuoteRef(ref);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load conversation messages on mount or ID change
  useEffect(() => {
    let isCancelled = false;
    setIsLoadingHistory(true);

    async function loadConversation() {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        if (!res.ok) throw new Error("Failed to load conversation");
        const data = await res.json();
        if (!isCancelled) {
          const loaded: MessageData[] = (data.messages || []).map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            status: m.status,
            errorMessage: m.errorMessage,
            coverage: m.coverage as CoverageDoc[] | null,
            quotes: (m.quotes || []).map((q: any) => ({
              id: q.id,
              ref: q.ref,
              documentId: q.documentId || documentId,
              documentName: q.document?.name || q.documentName || documentName,
              text: q.text,
              verified: q.verified,
              matchKind: q.matchKind,
              pageStart: q.ranges?.[0]?.occurrences?.[0]?.pageStart ?? null,
              pageEnd: q.ranges?.[0]?.occurrences?.[0]?.pageEnd ?? null,
              occurrences: q.ranges?.[0]?.occurrences?.length ?? 1,
              failReason: q.failReason,
              ranges: q.ranges,
            })),
          }));
          setMessages(loaded);
        }
      } catch (err) {
        console.error("Error loading conversation:", err);
      } finally {
        if (!isCancelled) setIsLoadingHistory(false);
      }
    }

    loadConversation();

    return () => {
      isCancelled = true;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [conversationId, documentId, documentName]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);

    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant" && last.status === "STREAMING") {
        copy[copy.length - 1] = { ...last, status: "STOPPED" };
      }
      return copy;
    });

    onConversationUpdated?.();
  };

  const handleSend = async (questionText?: string) => {
    const question = (questionText || inputValue).trim();
    if (!question || isStreaming) return;

    setInputValue("");

    // 1. Optimistic User Message
    const userMessageId = `user-${Date.now()}`;
    const userMsg: MessageData = {
      id: userMessageId,
      role: "user",
      content: question,
      status: "COMPLETE",
    };

    // 2. Placeholder Assistant Message
    const assistantTempId = `assistant-${Date.now()}`;
    const assistantMsg: MessageData = {
      id: assistantTempId,
      role: "assistant",
      content: "",
      status: "STREAMING",
      stage: "reading",
      quotes: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: question }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.error?.message || `Request failed with status ${res.status}`
        );
      }

      if (!res.body) throw new Error("No response body received");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseEvents(buffer);
        buffer = rest;

        for (const event of events) {
          if (controller.signal.aborted) break;

          setMessages((prev) => {
            const copy = [...prev];
            const idx = copy.findIndex((m) => m.id === assistantTempId);
            if (idx === -1) return prev;

            const current = { ...copy[idx] };

            switch (event.type) {
              case "status":
                current.stage = event.stage;
                if ("done" in event) current.stageDone = event.done;
                if ("total" in event) current.stageTotal = event.total;
                break;

              case "quotes":
                current.quotes = event.quotes.map((q) => ({
                  ref: q.ref,
                  documentId: q.documentId || documentId,
                  documentName: q.documentName || documentName,
                  text: q.text,
                  verified: q.verified,
                  matchKind: q.matchKind,
                  pageStart: q.pageStart,
                  pageEnd: q.pageEnd,
                  occurrences: q.occurrences,
                  failReason: q.failReason,
                  ranges: q.ranges,
                }));
                break;

              case "coverage":
                current.coverage = event.coverage;
                break;

              case "token":
                current.content = (current.content || "") + event.text;
                break;

              case "done":
                current.id = event.messageId;
                current.status =
                  event.status === "complete"
                    ? "COMPLETE"
                    : event.status === "stopped"
                    ? "STOPPED"
                    : "ERROR";
                current.stage = null;
                break;

              case "error":
                current.status = "ERROR";
                current.errorMessage = event.message;
                current.stage = null;
                break;
            }

            copy[idx] = current;
            return copy;
          });
        }
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        console.error("Stream error:", err);
        setMessages((prev) => {
          const copy = [...prev];
          const idx = copy.findIndex((m) => m.id === assistantTempId);
          if (idx !== -1) {
            copy[idx] = {
              ...copy[idx],
              status: "ERROR",
              errorMessage:
                err instanceof Error ? err.message : "Failed to generate answer.",
              stage: null,
            };
          }
          return copy;
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      onConversationUpdated?.();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuoteClick = (quote: QuoteData, occurrenceIndex = 0) => {
    setActiveQuoteRef(quote.ref);
    const el = document.getElementById(`quote-card-${quote.ref}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    onSelectQuote?.(quote, occurrenceIndex);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-paper min-w-0">
      {/* Scrollable messages container */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-48 text-ink-muted text-xs gap-2">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span>Loading conversation…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="max-w-md mx-auto my-16 text-center space-y-3">
            <h3 className="font-serif text-lg font-semibold text-ink">
              Ask about {documentName}
            </h3>
            <p className="text-sm text-ink-muted leading-relaxed">
              Every factual statement in Verbatim is backed by strict verbatim quotes
              from the contract text. Ask a question below to start.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            // Find last question for retry if needed
            const lastUserIdx = messages.findLastIndex((msg) => msg.role === "user");
            const lastQuestion =
              lastUserIdx !== -1 ? messages[lastUserIdx].content : undefined;

            return (
              <MessageItem
                key={m.id}
                message={m}
                activeQuoteRef={activeQuoteRef}
                activeOccurrenceIndex={activeOccurrenceIndex}
                onQuoteSelect={handleQuoteClick}
                onQuoteHover={(ref) => setActiveQuoteRef(ref)}
                onQuoteLeave={() => setActiveQuoteRef(null)}
                onRetry={lastQuestion ? () => handleSend(lastQuestion) : undefined}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Composer Bar */}
      <div className="p-4 border-t border-line bg-surface">
        <div className="max-w-3xl mx-auto flex items-end gap-2 bg-paper rounded-lg border border-line p-2 focus-within:border-accent transition-colors">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${documentName}…`}
            disabled={isStreaming}
            className="flex-1 bg-transparent border-0 resize-none text-sm text-ink placeholder:text-ink-faint focus:outline-none min-h-[36px] max-h-32 py-1.5 px-2"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-caution-soft text-caution hover:bg-caution-soft/80 border border-caution-line text-xs font-medium transition-colors"
              title="Stop response"
            >
              <Square size={13} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!inputValue.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent text-on-accent hover:bg-accent/90 disabled:opacity-40 text-xs font-medium transition-colors"
              title="Send question"
            >
              <Send size={13} />
              <span>Ask</span>
            </button>
          )}
        </div>
        <div className="max-w-3xl mx-auto mt-1.5 text-[11px] text-ink-faint text-center">
          Verbatim extracts and verifies exact quotes before composing answers.
        </div>
      </div>
    </div>
  );
}
