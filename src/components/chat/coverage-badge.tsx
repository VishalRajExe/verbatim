"use client";

import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { CoverageDoc } from "@/lib/qa/coverage";

interface CoverageBadgeProps {
  coverage?: CoverageDoc[] | null;
}

export function CoverageBadge({ coverage }: CoverageBadgeProps) {
  if (!coverage || coverage.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line/60">
      {coverage.map((doc, idx) => {
        const isComplete = doc.complete;
        const isMulti = coverage.length > 1;
        const docPrefix = isMulti ? `${doc.documentName}: ` : "";

        return (
          <div
            key={idx}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${
              isComplete
                ? "bg-verified-soft text-verified border border-verified-line/50"
                : "bg-caution-soft text-caution border border-caution-line"
            }`}
          >
            {isComplete ? (
              <CheckCircle2 size={13} className="text-verified shrink-0" />
            ) : (
              <AlertTriangle size={13} className="text-caution shrink-0" />
            )}
            <span>
              {docPrefix}
              {isComplete
                ? `Read all ${doc.chunksTotal} ${
                    doc.chunksTotal === 1 ? "section" : "sections"
                  }${doc.pages ? `, ${doc.pages} pages` : ""}`
                : `Read ${doc.chunksRead} of ${doc.chunksTotal} sections; absence is not confirmed`}
            </span>

            {doc.unreadablePages && doc.unreadablePages > 0 ? (
              <span className="text-[11px] text-caution font-normal">
                ({doc.unreadablePages} unreadable pages)
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
