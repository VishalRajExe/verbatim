"use client";

import React, { useMemo } from "react";
import { diffWordsWithSpace } from "diff";

interface WordDiffProps {
  oldText: string;
  newText: string;
}

export function WordDiff({ oldText, newText }: WordDiffProps) {
  const parts = useMemo(() => {
    return diffWordsWithSpace(oldText || "", newText || "");
  }, [oldText, newText]);

  return (
    <div className="text-sm font-serif leading-relaxed text-ink bg-surface-subtle p-3 rounded border border-line">
      {parts.map((part, index) => {
        if (part.added) {
          return (
            <ins
              key={index}
              className="bg-verified-soft text-verified underline decoration-verified px-0.5 rounded no-underline"
              style={{ backgroundColor: "var(--verified-soft)", color: "var(--verified)", textDecoration: "underline" }}
            >
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del
              key={index}
              className="bg-danger-soft text-danger line-through decoration-danger px-0.5 rounded"
              style={{ backgroundColor: "var(--danger-soft)", color: "var(--danger)", textDecoration: "line-through" }}
            >
              {part.value}
            </del>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </div>
  );
}
