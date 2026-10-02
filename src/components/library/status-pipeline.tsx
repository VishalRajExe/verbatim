"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";

export type DocStatus =
  | "QUEUED"
  | "CONVERTING"
  | "EXTRACTING"
  | "INDEXING"
  | "READY"
  | "FAILED";

interface StatusPipelineProps {
  status: DocStatus;
  kind: "pdf" | "docx" | string;
  stage?: string | null;
  progress: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export function StatusPipeline({
  status,
  kind,
  stage,
  progress,
  errorCode,
  errorMessage,
}: StatusPipelineProps) {
  if (status === "READY") {
    return (
      <div className="flex items-center gap-1.5 text-xs font-medium text-verified">
        <CheckCircle2 size={15} className="shrink-0" />
        <span>Ready</span>
      </div>
    );
  }

  if (status === "FAILED") {
    const isNoTextLayer = errorCode === "NO_TEXT_LAYER";
    return (
      <div className="flex flex-col space-y-0.5 text-xs text-danger">
        <div className="flex items-center gap-1.5 font-medium">
          <XCircle size={15} className="shrink-0" />
          <span>{isNoTextLayer ? "Can't read this file" : "Processing failed"}</span>
        </div>
        <p className="text-[11px] text-danger/80 pl-5">
          {errorMessage || (isNoTextLayer ? "no selectable text; OCR is not supported" : "Error")}
        </p>
      </div>
    );
  }

  // Active pipeline: determine step index
  // Steps for PDF: Queued -> Reading pages -> Preparing -> Ready
  // Steps for DOCX: Queued -> Converting -> Reading pages -> Preparing -> Ready
  const steps =
    kind === "docx"
      ? [
          { key: "QUEUED", label: "Queued" },
          { key: "CONVERTING", label: "Converting" },
          { key: "EXTRACTING", label: "Reading pages" },
          { key: "INDEXING", label: "Preparing" },
          { key: "READY", label: "Ready" },
        ]
      : [
          { key: "QUEUED", label: "Queued" },
          { key: "EXTRACTING", label: "Reading pages" },
          { key: "INDEXING", label: "Preparing" },
          { key: "READY", label: "Ready" },
        ];

  const currentStepIndex = steps.findIndex((s) => s.key === status);

  return (
    <div className="w-full max-w-xs space-y-2">
      {/* Live stage line */}
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="flex items-center gap-1 font-medium truncate">
          <Loader2 size={12} className="animate-spin shrink-0 text-accent" />
          <span className="truncate">{stage || "Processing..."}</span>
        </span>
        <span className="tabular-nums font-mono text-[11px] text-ink-faint pl-2">
          {progress}%
        </span>
      </div>

      {/* 4px progress bar */}
      <div className="h-1 w-full bg-line rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${Math.max(5, progress)}%` }}
        />
      </div>

      {/* Pipeline step dots */}
      <div className="flex items-center justify-between pt-0.5">
        {steps.map((step, idx) => {
          const isDone = currentStepIndex > idx;
          const isCurrent = currentStepIndex === idx;

          return (
            <div key={step.key} className="flex items-center gap-1">
              <div
                className={`w-2 h-2 rounded-full transition-all ${
                  isDone
                    ? "bg-accent"
                    : isCurrent
                    ? "bg-accent ring-2 ring-accent/30 scale-125"
                    : "bg-line"
                }`}
                title={step.label}
              />
              <span
                className={`text-[10px] hidden sm:inline ${
                  isCurrent ? "font-medium text-ink" : "text-ink-faint"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
