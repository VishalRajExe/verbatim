"use client";

import React from "react";

interface AnswerContentProps {
  content: string;
  onQuoteClick?: (refId: string) => void;
  onQuoteHover?: (refId: string) => void;
  onQuoteLeave?: () => void;
}

export function AnswerContent({
  content,
  onQuoteClick,
  onQuoteHover,
  onQuoteLeave,
}: AnswerContentProps) {
  if (!content) return null;

  // Split into paragraphs first
  const paragraphs = content.split(/\n\n+/);

  return (
    <div className="space-y-3 font-sans text-[15px] leading-relaxed text-ink max-w-[68ch]">
      {paragraphs.map((paragraph, pIdx) => {
        // Tokenize by citation markers [Q1], [Q2], [Q1, Q2], etc.
        const parts = paragraph.split(/(\[(?:Q\d+(?:\s*,\s*Q\d+)*)\])/g);

        return (
          <p key={pIdx}>
            {parts.map((part, idx) => {
              const match = /^\[(.*)\]$/.exec(part);
              if (match) {
                const refs = match[1]
                  .split(",")
                  .map((r) => r.trim())
                  .filter((r) => /^Q\d+$/.test(r));

                if (refs.length > 0) {
                  return (
                    <span key={idx} className="inline-flex items-center gap-1 mx-0.5 align-baseline">
                      {refs.map((refId) => (
                        <button
                          key={refId}
                          type="button"
                          onClick={() => onQuoteClick?.(refId)}
                          onMouseEnter={() => onQuoteHover?.(refId)}
                          onMouseLeave={() => onQuoteLeave?.()}
                          className="inline-flex items-center px-1.5 py-0.5 text-xs font-semibold tracking-tight rounded-full bg-verified-soft text-verified border border-verified-line/80 hover:bg-verified hover:text-white transition-colors cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-accent"
                          title={`Jump to verified quote ${refId}`}
                          aria-label={`Verified quote ${refId}`}
                        >
                          {refId}
                        </button>
                      ))}
                    </span>
                  );
                }
              }
              return <React.Fragment key={idx}>{part}</React.Fragment>;
            })}
          </p>
        );
      })}
    </div>
  );
}
