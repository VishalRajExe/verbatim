"use client";

import React, { useState } from "react";
import { Loader2, AlertCircle, ChevronDown, RotateCcw } from "lucide-react";
import { QuoteCard } from "./quote-card";
import { AnswerContent } from "./answer-content";
import { CoverageBadge } from "./coverage-badge";
import type { CoverageDoc } from "@/lib/qa/coverage";

export interface QuoteData {
  id?: string;
  ref: string;
  text: string;
  verified: boolean;
  matchKind?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  occurrences?: number;
  failReason?: string | null;
}

export interface MessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "STREAMING" | "COMPLETE" | "STOPPED" | "ERROR";
  stage?: string | null;
  stageDone?: number;
  stageTotal?: number;
  coverage?: CoverageDoc[] | null;
  errorMessage?: string | null;
  quotes?: QuoteData[];
}

interface MessageItemProps {
  message: MessageData;
  activeQuoteRef?: string | null;
  onQuoteSelect?: (refId: string) => void;
  onQuoteHover?: (refId: string) => void;
  onQuoteLeave?: () => void;
  onRetry?: () => void;
}

export function MessageItem({
  message,
  activeQuoteRef,
  onQuoteSelect,
  onQuoteHover,
  onQuoteLeave,
  onRetry,
}: MessageItemProps) {
  const [showUnverified, setShowUnverified] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end my-4">
        <div className="max-w-[70%] bg-surface border border-line rounded-lg p-4 shadow-sm">
          <div className="text-xs font-semibold text-ink-muted mb-1">You</div>
          <div className="font-sans text-[15px] leading-relaxed text-ink whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  const verifiedQuotes = message.quotes?.filter((q) => q.verified) || [];
  const unverifiedQuotes = message.quotes?.filter((q) => !q.verified) || [];
  const isStreaming = message.status === "STREAMING";
  const isStopped = message.status === "STOPPED";
  const isError = message.status === "ERROR";

  const stageText = (() => {
    if (!message.stage) return null;
    if (message.stage === "reading") {
      return `Reading section ${message.stageDone || 1} of ${message.stageTotal || 1}…`;
    }
    if (message.stage === "verifying") {
      return "Verifying extracted quotes against canonical text…";
    }
    if (message.stage === "composing") {
      return "Writing answer…";
    }
    return message.stage;
  })();

  return (
    <div className="my-6 border border-line rounded-xl bg-surface p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-serif font-bold text-sm text-ink">Verbatim</span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-xs text-accent">
              <Loader2 size={13} className="animate-spin" />
              <span>{stageText || "Thinking…"}</span>
            </span>
          )}
          {isStopped && (
            <span className="text-[11px] font-medium text-caution bg-caution-soft px-2 py-0.5 rounded border border-caution-line">
              Stopped
            </span>
          )}
        </div>
      </div>

      {/* Verified quotes section */}
      {verifiedQuotes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Verified quotes ({verifiedQuotes.length})
          </div>
          <div className="space-y-1">
            {verifiedQuotes.map((q) => (
              <QuoteCard
                key={q.ref}
                refId={q.ref}
                text={q.text}
                verified={true}
                matchKind={q.matchKind}
                pageStart={q.pageStart}
                pageEnd={q.pageEnd}
                occurrences={q.occurrences || 1}
                isActive={activeQuoteRef === q.ref}
                onSelect={() => onQuoteSelect?.(q.ref)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unverified quotes (collapsed disclosure) */}
      {unverifiedQuotes.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowUnverified(!showUnverified)}
            className="flex items-center gap-1.5 text-xs font-medium text-caution hover:text-caution/80 py-1 transition-colors"
            aria-expanded={showUnverified}
          >
            <span>
              {unverifiedQuotes.length}{" "}
              {unverifiedQuotes.length === 1
                ? "quote couldn't be verified"
                : "quotes couldn't be verified"}
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${
                showUnverified ? "rotate-180" : ""
              }`}
            />
          </button>

          {showUnverified && (
            <div className="mt-2 space-y-1">
              {unverifiedQuotes.map((q) => (
                <QuoteCard
                  key={q.ref}
                  refId={q.ref}
                  text={q.text}
                  verified={false}
                  failReason={q.failReason}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Streamed or completed answer text */}
      {message.content && (
        <div className="pt-2">
          <AnswerContent
            content={message.content}
            onQuoteClick={onQuoteSelect}
            onQuoteHover={onQuoteHover}
            onQuoteLeave={onQuoteLeave}
          />
        </div>
      )}

      {/* Error state with retry */}
      {isError && (
        <div className="rounded-lg bg-danger-soft border border-danger/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-danger font-medium text-sm">
            <AlertCircle size={16} />
            <span>Could not complete answer</span>
          </div>
          <p className="text-xs text-ink-muted">
            {message.errorMessage || "An error occurred while generating the response."}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent/90 transition-colors"
            >
              <RotateCcw size={13} />
              <span>Try again</span>
            </button>
          )}
        </div>
      )}

      {/* Coverage badge */}
      {message.coverage && message.coverage.length > 0 && (
        <CoverageBadge coverage={message.coverage} />
      )}
    </div>
  );
}
