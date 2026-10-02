"use client";

import React, { useState } from "react";
import { BadgeCheck, CircleHelp, ChevronLeft, ChevronRight } from "lucide-react";

export interface QuoteCardProps {
  refId: string; // e.g. "Q1", "U1"
  text: string;
  verified: boolean;
  matchKind?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  occurrences?: number;
  failReason?: string | null;
  isActive?: boolean;
  activeOccurrenceIndex?: number;
  onSelect?: () => void;
  onSelectOccurrence?: (occurrenceIndex: number) => void;
}

export function QuoteCard({
  refId,
  text,
  verified,
  matchKind,
  pageStart,
  pageEnd,
  occurrences = 1,
  failReason,
  isActive = false,
  activeOccurrenceIndex,
  onSelect,
  onSelectOccurrence,
}: QuoteCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentOccurrence, setCurrentOccurrence] = useState(
    activeOccurrenceIndex !== undefined ? activeOccurrenceIndex + 1 : 1
  );

  React.useEffect(() => {
    if (activeOccurrenceIndex !== undefined) {
      setCurrentOccurrence(activeOccurrenceIndex + 1);
    }
  }, [activeOccurrenceIndex]);

  const isLong = text.length > 320;
  const displayText = isLong && !isExpanded ? text.slice(0, 300) + "…" : text;

  const pageLabel = (() => {
    if (pageStart === null || pageStart === undefined) return null;
    if (pageEnd === null || pageEnd === undefined || pageStart === pageEnd) {
      return `Page ${pageStart}`;
    }
    return `Pages ${pageStart} to ${pageEnd}`;
  })();

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextVal = currentOccurrence > 1 ? currentOccurrence - 1 : occurrences;
    setCurrentOccurrence(nextVal);
    onSelectOccurrence?.(nextVal - 1);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextVal = currentOccurrence < occurrences ? currentOccurrence + 1 : 1;
    setCurrentOccurrence(nextVal);
    onSelectOccurrence?.(nextVal - 1);
  };

  return (
    <div
      id={`quote-card-${refId}`}
      tabIndex={verified ? 0 : -1}
      role={verified ? "button" : "region"}
      aria-label={
        verified
          ? `Verified quote ${refId}, ${pageLabel || "document passage"}`
          : `Unverified quote ${refId}`
      }
      onClick={() => {
        if (verified && onSelect) onSelect();
      }}
      onKeyDown={(e) => {
        if (verified && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={`text-left w-full transition-colors rounded-r-[2px] rounded-l-none border-y border-r p-3 my-2 ${
        verified
          ? isActive
            ? "border-l-[3px] border-l-accent border-y-line border-r-line bg-accent-soft"
            : "border-l-[3px] border-l-verified border-y-line border-r-line bg-surface hover:bg-surface-subtle cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
          : "border-l-[3px] border-l-dashed border-l-caution-line border-y-line border-r-line bg-caution-soft/20 text-ink-muted"
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 text-xs font-sans">
        <div className="flex items-center gap-1.5">
          {verified ? (
            <>
              <BadgeCheck size={16} className="text-verified shrink-0" strokeWidth={1.75} />
              <span className="font-semibold text-verified">Verified</span>
              <span className="text-ink-faint">·</span>
              <span className="font-medium text-ink-muted">{refId}</span>
              {pageLabel && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span className="font-medium text-ink-muted">{pageLabel}</span>
                </>
              )}
            </>
          ) : (
            <>
              <CircleHelp size={16} className="text-caution shrink-0" strokeWidth={1.75} />
              <span className="font-semibold text-caution">Couldn&apos;t be verified</span>
              {failReason && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span className="text-[11px] text-ink-faint font-mono">{failReason}</span>
                </>
              )}
            </>
          )}
        </div>

        {/* Stepper for multiple occurrences */}
        {verified && occurrences > 1 && (
          <div className="flex items-center gap-1 text-[11px] text-ink-muted bg-surface px-1.5 py-0.5 rounded border border-line">
            <span>Appears {occurrences} times</span>
            <div className="flex items-center ml-1">
              <button
                type="button"
                onClick={handlePrev}
                className="p-0.5 hover:text-ink hover:bg-surface-subtle rounded transition-colors"
                title="Previous occurrence"
                aria-label="Previous occurrence"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="px-1 tabular-nums">
                {currentOccurrence} of {occurrences}
              </span>
              <button
                type="button"
                onClick={handleNext}
                className="p-0.5 hover:text-ink hover:bg-surface-subtle rounded transition-colors"
                title="Next occurrence"
                aria-label="Next occurrence"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quote text in serif */}
      <div className={`font-serif text-sm leading-relaxed max-w-[72ch] ${verified ? "text-ink" : "text-ink-muted"}`}>
        &ldquo;{displayText}&rdquo;
      </div>

      {/* Expand / Collapse toggle for long quotes */}
      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="mt-1.5 text-xs text-accent hover:underline font-sans font-medium"
        >
          {isExpanded ? "Show less" : "Show full quote"}
        </button>
      )}
    </div>
  );
}
