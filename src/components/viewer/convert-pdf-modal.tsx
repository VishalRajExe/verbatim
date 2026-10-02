"use client";

import React, { useState } from "react";
import { AlertCircle, FileCode, Loader2, X } from "lucide-react";

interface ConvertPdfModalProps {
  isOpen: boolean;
  documentId: string;
  documentName: string;
  onClose: () => void;
  onSuccess?: () => void;
  onConversionSuccess?: () => void;
}

export function ConvertPdfModal({
  isOpen,
  documentId,
  documentName,
  onClose,
  onSuccess,
  onConversionSuccess,
}: ConvertPdfModalProps) {
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(10);
  const [stage, setStage] = useState("Queued");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const triggerSuccess = () => {
    if (onSuccess) onSuccess();
    if (onConversionSuccess) onConversionSuccess();
  };

  const handleConvert = async () => {
    setIsConverting(true);
    setError(null);
    setProgress(15);
    setStage("Converting DOCX to PDF…");

    // Smoothly increment progress simulation while server converts
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev < 30) {
          setStage("Converting DOCX to PDF…");
          return prev + 5;
        }
        if (prev < 70) {
          setStage("Reading pages…");
          return prev + 8;
        }
        if (prev < 90) {
          setStage("Preparing…");
          return prev + 4;
        }
        return prev;
      });
    }, 600);

    try {
      const res = await fetch(`/api/documents/${documentId}/convert-pdf`, {
        method: "POST",
      });

      clearInterval(timer);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error?.message || "PDF conversion failed. Your original DOCX is still available."
        );
      }

      setProgress(100);
      setStage("Ready");
      setTimeout(() => {
        setIsConverting(false);
        triggerSuccess();
      }, 400);
    } catch (err: unknown) {
      clearInterval(timer);
      setIsConverting(false);
      setError(
        err instanceof Error
          ? err.message
          : "PDF conversion failed. Your original DOCX is still available."
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-surface border border-line rounded-xl max-w-md w-full p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-red-50 text-red-700 border border-red-200 flex items-center justify-center shrink-0">
              <FileCode size={18} />
            </div>
            <div>
              <h3 className="font-serif text-base font-semibold text-ink">
                Convert DOCX to PDF?
              </h3>
              <p className="text-xs text-ink-muted truncate max-w-[260px]" title={documentName}>
                {documentName}
              </p>
            </div>
          </div>
          {!isConverting && (
            <button
              onClick={onClose}
              className="p-1 text-ink-muted hover:text-ink rounded transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="space-y-3">
          <p className="text-xs text-ink-muted leading-relaxed">
            This is only required for PDF-style viewing and highlighting.
            Redlining and Word document viewing already work directly with the original DOCX.
          </p>

          {isConverting && (
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin text-accent" />
                  <span>Converting DOCX to PDF</span>
                </span>
                <span className="font-mono text-ink-muted">{progress}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-line/60 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-accent h-full transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Step indicator */}
              <div className="flex items-center justify-between text-[10px] text-ink-muted pt-1">
                <span className={progress >= 10 ? "text-ink font-semibold" : ""}>Queued</span>
                <span>→</span>
                <span className={progress >= 20 ? "text-ink font-semibold" : ""}>Converting</span>
                <span>→</span>
                <span className={progress >= 60 ? "text-ink font-semibold" : ""}>Reading pages</span>
                <span>→</span>
                <span className={progress >= 85 ? "text-ink font-semibold" : ""}>Preparing</span>
                <span>→</span>
                <span className={progress >= 100 ? "text-verified font-semibold" : ""}>Ready</span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-danger-soft border border-danger/20 rounded-lg flex items-start gap-2.5 text-xs text-danger">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {!isConverting && (
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-md border border-line bg-surface text-ink hover:bg-paper transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConvert}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors shadow-sm"
            >
              <FileCode size={13} />
              <span>Convert to PDF</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
