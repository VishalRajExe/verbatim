"use client";

import React, { useState } from "react";
import { AlertOctagon, TriangleAlert, Minus, Type, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { WordDiff } from "./word-diff";

export interface ComparisonChangeItem {
  id: string;
  orderIdx: number;
  type: string; // ADDED | REMOVED | MODIFIED | MOVED
  significance: string; // HIGH | MEDIUM | LOW | COSMETIC
  category: string | null;
  title: string;
  summary: string;
  summarySource: string; // ai | automatic
  aText: string | null;
  bText: string | null;
  aStart: number | null;
  aEnd: number | null;
  bStart: number | null;
  bEnd: number | null;
}

interface ChangeCardProps {
  change: ComparisonChangeItem;
  docAId: string;
  docAName: string;
  docBId: string;
  docBName: string;
  onOpenViewer: (docId: string, docName: string, text: string, start: number, end: number, label: string) => void;
}

export function ChangeCard({
  change,
  docAId,
  docAName,
  docBId,
  docBName,
  onOpenViewer,
}: ChangeCardProps) {
  const [showFullText, setShowFullText] = useState(false);

  // Significance styling
  const sig = change.significance.toUpperCase();
  let sigBadge = {
    bg: "bg-faint-soft",
    text: "text-faint",
    border: "border-faint",
    borderLeft: "border-l-faint",
    icon: Type,
    label: "Cosmetic",
  };

  if (sig === "HIGH") {
    sigBadge = {
      bg: "bg-danger-soft",
      text: "text-danger",
      border: "border-danger",
      borderLeft: "border-l-danger",
      icon: AlertOctagon,
      label: "High",
    };
  } else if (sig === "MEDIUM") {
    sigBadge = {
      bg: "bg-caution-soft",
      text: "text-caution",
      border: "border-caution",
      borderLeft: "border-l-caution",
      icon: TriangleAlert,
      label: "Medium",
    };
  } else if (sig === "LOW") {
    sigBadge = {
      bg: "bg-slate-soft",
      text: "text-slate",
      border: "border-slate",
      borderLeft: "border-l-slate",
      icon: Minus,
      label: "Low",
    };
  }

  const SigIcon = sigBadge.icon;
  const isModified = change.type === "MODIFIED";
  const isAdded = change.type === "ADDED";
  const isRemoved = change.type === "REMOVED";
  const isMoved = change.type === "MOVED";

  return (
    <article
      className={`bg-surface rounded-lg border border-line p-4 shadow-sm space-y-3 border-l-4 ${sigBadge.borderLeft}`}
      aria-labelledby={`change-title-${change.id}`}
    >
      {/* Header Row: Title, Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 id={`change-title-${change.id}`} className="text-base font-semibold text-ink">
            {change.title}
          </h3>
          {change.category && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-surface-subtle border border-line text-ink-muted capitalize">
              {change.category.replace(/_/g, " ")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Significance Tag */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${sigBadge.bg} ${sigBadge.text}`}
          >
            <SigIcon className="h-3.5 w-3.5" />
            {sigBadge.label}
          </span>

          {/* Change Type Tag */}
          <span className="text-xs font-medium px-2 py-0.5 rounded border border-line text-ink-muted">
            {change.type.charAt(0) + change.type.slice(1).toLowerCase()}
          </span>

          {/* Automatic Summary Tag */}
          {change.summarySource === "automatic" && (
            <span className="text-[11px] text-ink-faint px-1.5 py-0.5 rounded bg-surface-subtle">
              Automatic summary
            </span>
          )}
        </div>
      </div>

      {/* Substantive Summary */}
      <p className="text-sm text-ink font-medium leading-relaxed">
        {change.summary}
      </p>

      {/* Diff / Clause Content Display */}
      {isModified && change.aText && change.bText && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted">Word-level changes</span>
            <button
              type="button"
              onClick={() => setShowFullText(!showFullText)}
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              {showFullText ? (
                <>
                  <span>Side-by-side view</span>
                  <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <span>Separate text view</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>

          <WordDiff oldText={change.aText} newText={change.bText} />

          {showFullText && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-xs font-serif">
              <div className="p-2.5 rounded bg-surface-subtle border border-line">
                <span className="text-[11px] font-sans font-medium text-ink-muted block mb-1">
                  Older version ({docAName}):
                </span>
                <p className="text-ink leading-relaxed whitespace-pre-wrap">{change.aText}</p>
              </div>
              <div className="p-2.5 rounded bg-surface-subtle border border-line">
                <span className="text-[11px] font-sans font-medium text-ink-muted block mb-1">
                  Newer version ({docBName}):
                </span>
                <p className="text-ink leading-relaxed whitespace-pre-wrap">{change.bText}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdded && change.bText && (
        <div className="p-3 rounded bg-verified-soft/30 border border-verified-line/50 space-y-1">
          <span className="text-xs font-sans font-medium text-verified block">
            Added in {docBName}:
          </span>
          <p className="text-sm font-serif text-ink leading-relaxed whitespace-pre-wrap">
            {change.bText}
          </p>
        </div>
      )}

      {isRemoved && change.aText && (
        <div className="p-3 rounded bg-danger-soft/30 border border-danger/20 space-y-1">
          <span className="text-xs font-sans font-medium text-danger block">
            Removed from {docAName}:
          </span>
          <p className="text-sm font-serif text-ink-muted line-through leading-relaxed whitespace-pre-wrap">
            {change.aText}
          </p>
        </div>
      )}

      {isMoved && (
        <div className="p-3 rounded bg-surface-subtle border border-line space-y-1">
          <span className="text-xs font-sans font-medium text-ink-muted block">
            Moved clause (wording identical between versions):
          </span>
          <p className="text-sm font-serif text-ink leading-relaxed whitespace-pre-wrap">
            {change.bText || change.aText}
          </p>
        </div>
      )}

      {/* Action Footer: Open in documents */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-line">
        {change.aStart !== null && change.aEnd !== null && (
          <button
            type="button"
            onClick={() =>
              onOpenViewer(
                docAId,
                docAName,
                change.aText || change.title,
                change.aStart!,
                change.aEnd!,
                `Older: ${docAName}`
              )
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-surface hover:bg-surface-subtle border border-line text-ink transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 text-accent" />
            <span>Open in older ({docAName})</span>
          </button>
        )}

        {change.bStart !== null && change.bEnd !== null && (
          <button
            type="button"
            onClick={() =>
              onOpenViewer(
                docBId,
                docBName,
                change.bText || change.title,
                change.bStart!,
                change.bEnd!,
                `Newer: ${docBName}`
              )
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-accent-soft hover:bg-accent-soft/80 border border-accent/20 text-accent transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 text-accent" />
            <span>Open in newer ({docBName})</span>
          </button>
        )}
      </div>
    </article>
  );
}
