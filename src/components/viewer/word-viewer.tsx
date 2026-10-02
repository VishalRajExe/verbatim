"use client";

import React, { useState, useEffect } from "react";
import {
  FileText,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Eye,
  FileCode,
  Loader2,
  AlertCircle,
  X,
  FileCheck,
} from "lucide-react";

interface WordViewerProps {
  documentId: string;
  documentName: string;
  isRedline?: boolean;
  redlineId?: string; // Optional: view redlined version directly
  initialHtml?: string;
  onClose?: () => void;
  onSwitchToPdf?: () => void;
  hasPdfRendition?: boolean;
}

export function WordViewer({
  documentId,
  documentName,
  isRedline,
  redlineId,
  initialHtml,
  onClose,
  onSwitchToPdf,
  hasPdfRendition,
}: WordViewerProps) {
  const [html, setHtml] = useState<string | null>(initialHtml || null);
  const [isLoading, setIsLoading] = useState(!initialHtml);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(100);
  const [showRevisions, setShowRevisions] = useState<boolean>(true);

  const fetchUrl = redlineId
    ? `/api/redlines/${redlineId}/view?revisions=${showRevisions}`
    : `/api/documents/${documentId}/view?revisions=${showRevisions}`;

  useEffect(() => {
    let isMounted = true;
    async function loadDocxHtml() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) {
          throw new Error("Unable to preview this Word document. Download the DOCX instead.");
        }
        const data = await res.json();
        if (isMounted) {
          setHtml(data.html || "<p class='text-ink-muted italic'>Empty document content.</p>");
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to preview this Word document. Download the DOCX instead."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDocxHtml();

    return () => {
      isMounted = false;
    };
  }, [fetchUrl]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 15, 175));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 15, 70));
  const handleZoomReset = () => setZoom(100);

  const handleDownload = () => {
    if (redlineId) {
      window.location.href = `/api/redlines/${redlineId}/download`;
    } else {
      window.location.href = `/api/documents/${documentId}/download`;
    }
  };

  const hasRevisions = html && (html.includes("docx-ins") || html.includes("docx-del"));

  return (
    <div className="flex flex-col h-full w-full bg-paper border-l border-line overflow-hidden">
      {/* Top Controls Toolbar */}
      <header className="flex items-center justify-between px-4 py-3 bg-surface border-b border-line shrink-0 gap-3 shadow-xs">
        {/* Left: Document info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
            <FileText size={15} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-ink truncate" title={documentName}>
              {documentName}
            </h2>
            <div className="flex items-center gap-2 text-[10px] text-ink-muted">
              <span>Word Document (.docx)</span>
              {redlineId && (
                <>
                  <span>•</span>
                  <span className="text-verified font-medium">Tracked Changes Preview</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions and Toolbar */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Revisions Toggle (when viewing redlined document) */}
          {hasRevisions && (
            <button
              type="button"
              onClick={() => setShowRevisions((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                showRevisions
                  ? "bg-accent-soft text-accent border-accent/30"
                  : "bg-surface text-ink-muted border-line hover:text-ink"
              }`}
              title="Toggle tracked changes view"
            >
              <Eye size={12} />
              <span>{showRevisions ? "Showing Revisions" : "Final Clean"}</span>
            </button>
          )}

          {/* Zoom controls */}
          <div className="flex items-center border border-line rounded bg-surface">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 70}
              className="p-1.5 text-ink-muted hover:text-ink disabled:opacity-30 transition-colors"
              title="Zoom out"
            >
              <ZoomOut size={13} />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-ink-muted min-w-[42px] text-center select-none">
              {zoom}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 175}
              className="p-1.5 text-ink-muted hover:text-ink disabled:opacity-30 transition-colors"
              title="Zoom in"
            >
              <ZoomIn size={13} />
            </button>
            {zoom !== 100 && (
              <button
                type="button"
                onClick={handleZoomReset}
                className="p-1.5 text-ink-muted hover:text-ink border-l border-line transition-colors"
                title="Reset zoom"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>

          {/* Switch to PDF if available or requested */}
          {onSwitchToPdf && (
            <button
              type="button"
              onClick={onSwitchToPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-line bg-surface text-ink hover:bg-paper transition-colors"
              title="View as PDF"
            >
              <FileCode size={13} className="text-red-600" />
              <span>View PDF</span>
            </button>
          )}

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-line bg-surface text-ink hover:bg-paper transition-colors"
            title="Download document"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Download</span>
          </button>

          {/* Close button */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-ink-muted hover:text-ink rounded transition-colors"
              title="Close viewer"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Main Document Body Canvas */}
      <main className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center bg-sunken/40">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-center my-auto">
            <Loader2 className="h-8 w-8 text-accent animate-spin mb-3" />
            <p className="text-sm font-medium text-ink">Loading Word document…</p>
            <p className="text-xs text-ink-muted mt-1">Reading document structure and tables</p>
          </div>
        ) : error ? (
          <div className="max-w-md w-full bg-surface border border-line rounded-xl p-8 text-center space-y-4 shadow-sm my-auto">
            <div className="w-12 h-12 rounded-full bg-caution-soft text-caution flex items-center justify-center mx-auto">
              <AlertCircle size={24} />
            </div>
            <h3 className="font-serif text-base font-semibold text-ink">
              Unable to Preview Document
            </h3>
            <p className="text-xs text-ink-muted leading-relaxed">{error}</p>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors shadow-sm"
            >
              <Download size={14} />
              <span>Download DOCX File</span>
            </button>
          </div>
        ) : (
          /* Word Document Paper Sheet Presentation */
          <article
            style={{
              zoom: `${zoom}%`,
              transformOrigin: "top center",
            }}
            className="w-full max-w-4xl bg-surface border border-line rounded-lg shadow-md p-8 sm:p-14 min-h-[900px] text-ink transition-transform duration-100"
          >
            {/* Header branding strip inside paper */}
            <div className="flex items-center justify-between pb-6 mb-8 border-b border-line/50 text-[11px] text-ink-muted">
              <div className="flex items-center gap-2">
                <FileCheck size={14} className="text-accent" />
                <span className="font-medium tracking-wide">VERBATIM DOCUMENT VIEWER</span>
              </div>
              <span>{documentName}</span>
            </div>

            {/* Document Content Rendered */}
            <div
              className="docx-content space-y-2 select-text"
              dangerouslySetInnerHTML={{ __html: html || "" }}
            />
          </article>
        )}
      </main>
    </div>
  );
}
