"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  PdfHighlighterUtils,
  Highlight,
  useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import {
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  Download,
  RotateCcw,
} from "lucide-react";
import type { ActiveQuoteTarget } from "./types";
import type { PageHighlight } from "@/lib/verify/locate";

interface PdfViewerInnerProps {
  documentId: string;
  documentName: string;
  activeQuote: ActiveQuoteTarget | null;
  onClose: () => void;
  onChangeOccurrence?: (newIndex: number) => void;
}

function CustomHighlightRenderer() {
  const { highlight, isScrolledTo } = useHighlightContainerContext();
  return (
    <div
      className={`verbatim-highlight-wrapper ${
        isScrolledTo ? "verbatim-highlight-active verbatim-highlight-pulse" : ""
      }`}
    >
      <TextHighlight isScrolledTo={isScrolledTo} highlight={highlight} />
    </div>
  );
}

export default function PdfViewerInner({
  documentId,
  documentName,
  activeQuote,
  onClose,
  onChangeOccurrence,
}: PdfViewerInnerProps) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [scale, setScale] = useState<number>(1.15);
  const [currentPage, setCurrentPage] = useState<number>(
    activeQuote?.pageStart || 1
  );
  const [totalPages, setTotalPages] = useState<number>(
    activeQuote?.pageEnd || 1
  );
  const [crossPageText, setCrossPageText] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const renditionUrl = `/api/documents/${documentId}/rendition`;

  // Close on Escape key (TASK 8)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Locate and scroll to quote highlights whenever activeQuote changes
  useEffect(() => {
    if (!activeQuote) {
      setHighlights([]);
      setCrossPageText(null);
      return;
    }

    let isMounted = true;
    setIsLocating(true);
    setLocateError(null);

    const fetchQuoteHighlights = async () => {
      try {
        // Find canonical range for the active occurrence
        const segment = activeQuote.ranges?.[0];
        const occurrences = segment?.occurrences;
        const currentOcc =
          (occurrences && occurrences[activeQuote.currentOccurrenceIndex]) ||
          segment?.primary;

        if (!currentOcc) {
          // If ranges are not supplied, fallback to empty highlights
          if (isMounted) {
            setIsLocating(false);
          }
          return;
        }

        const res = await fetch(
          `/api/documents/${activeQuote.documentId}/locate?ranges=${currentOcc.start}-${currentOcc.end}`
        );

        if (!res.ok) {
          throw new Error(`Failed to locate passage (${res.status})`);
        }

        const data: { highlights: PageHighlight[] } = await res.json();
        if (!isMounted) return;

        const pageHighlights = data.highlights || [];
        if (pageHighlights.length === 0) {
          setHighlights([]);
          setCrossPageText(null);
          setIsLocating(false);
          return;
        }

        // Build viewer highlight objects (TASK 3 & 4)
        const builtHighlights: Highlight[] = pageHighlights.map((h, idx) => ({
          id: `${activeQuote.ref}-occ${activeQuote.currentOccurrenceIndex}-p${h.pageNumber}-${idx}`,
          type: "text",
          position: {
            boundingRect: {
              x1: h.boundingRect.x1,
              y1: h.boundingRect.y1,
              x2: h.boundingRect.x2,
              y2: h.boundingRect.y2,
              width: h.width,
              height: h.height,
              pageNumber: h.pageNumber,
            },
            rects: h.rects.map((r) => ({
              x1: r.x1,
              y1: r.y1,
              x2: r.x2,
              y2: r.y2,
              width: h.width,
              height: h.height,
              pageNumber: h.pageNumber,
            })),
            usePdfCoordinates: false,
          },
        }));

        setHighlights(builtHighlights);
        setCurrentPage(pageHighlights[0].pageNumber);

        // Cross-page handling (TASK 5)
        if (pageHighlights.length > 1) {
          const nextPages = pageHighlights
            .slice(1)
            .map((p) => p.pageNumber)
            .join(", ");
          setCrossPageText(`Passage continues on page ${nextPages}`);
        } else {
          setCrossPageText(null);
        }

        // Scroll to the first occurrence highlight
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          if (highlighterUtilsRef.current && builtHighlights[0]) {
            try {
              highlighterUtilsRef.current.scrollToHighlight(builtHighlights[0]);
            } catch (err) {
              console.warn("scrollToHighlight error:", err);
            }
          }
        }, 300);
      } catch (err: unknown) {
        if (isMounted) {
          setLocateError(err instanceof Error ? err.message : "Failed to locate passage");
        }
      } finally {
        if (isMounted) {
          setIsLocating(false);
        }
      }
    };

    fetchQuoteHighlights();

    return () => {
      isMounted = false;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [activeQuote, reloadKey]);

  // Stepper handlers for repeated quotes (TASK 6)
  const totalOccurrences = activeQuote?.occurrences || 1;
  const currentOccIndex = activeQuote?.currentOccurrenceIndex ?? 0;

  const handlePrevOccurrence = useCallback(() => {
    if (totalOccurrences <= 1) return;
    const nextIdx =
      currentOccIndex > 0 ? currentOccIndex - 1 : totalOccurrences - 1;
    onChangeOccurrence?.(nextIdx);
  }, [currentOccIndex, totalOccurrences, onChangeOccurrence]);

  const handleNextOccurrence = useCallback(() => {
    if (totalOccurrences <= 1) return;
    const nextIdx =
      currentOccIndex < totalOccurrences - 1 ? currentOccIndex + 1 : 0;
    onChangeOccurrence?.(nextIdx);
  }, [currentOccIndex, totalOccurrences, onChangeOccurrence]);

  // Zoom handlers
  const handleZoomIn = () => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)));
  const handleZoomOut = () => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)));
  const handleZoomReset = () => setScale(1.15);

  return (
    <aside
      aria-label="Document viewer"
      className="flex flex-col h-full w-full bg-paper border-l border-line select-none overflow-hidden"
    >
      {/* Viewer Header Chrome (TASK 2) */}
      <header className="h-12 border-b border-line bg-surface px-4 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="font-serif font-semibold text-sm text-ink truncate max-w-[180px] sm:max-w-[240px]"
            title={documentName}
          >
            {documentName}
          </span>
          <span className="text-line-strong">|</span>
          <span className="text-xs font-mono text-ink-muted shrink-0">
            Page {currentPage} of {totalPages}
          </span>
        </div>

        {/* Controls: Stepper (TASK 6), Zoom, Close */}
        <div className="flex items-center gap-2">
          {/* Repeated quote stepper */}
          {totalOccurrences > 1 && (
            <div className="flex items-center gap-1 bg-surface-subtle px-2 py-0.5 rounded border border-line text-xs font-sans text-ink">
              <span className="hidden sm:inline text-ink-muted">Appears {totalOccurrences} times:</span>
              <button
                type="button"
                onClick={handlePrevOccurrence}
                aria-label="Previous occurrence"
                title="Previous occurrence"
                className="p-1 hover:text-accent rounded transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="tabular-nums font-mono font-medium px-0.5">
                {currentOccIndex + 1} of {totalOccurrences}
              </span>
              <button
                type="button"
                onClick={handleNextOccurrence}
                aria-label="Next occurrence"
                title="Next occurrence"
                className="p-1 hover:text-accent rounded transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 bg-surface-subtle p-0.5 rounded border border-line">
            <button
              type="button"
              onClick={handleZoomOut}
              aria-label="Zoom out"
              title="Zoom out"
              className="p-1 hover:bg-surface text-ink-muted hover:text-ink rounded transition-colors"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              aria-label="Reset zoom"
              title="Reset zoom"
              className="px-1.5 py-0.5 text-[11px] font-mono font-medium text-ink-muted hover:text-ink hover:bg-surface rounded transition-colors"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              aria-label="Zoom in"
              title="Zoom in"
              className="p-1 hover:bg-surface text-ink-muted hover:text-ink rounded transition-colors"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            title="Close viewer (Esc)"
            className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-subtle rounded transition-colors ml-1"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Cross-page banner (TASK 5) */}
      {crossPageText && (
        <div className="bg-verified-soft/90 border-b border-verified-line px-4 py-1.5 text-xs text-verified font-medium flex items-center gap-2 shrink-0 animate-fadeIn">
          <span className="w-1.5 h-1.5 rounded-full bg-verified animate-ping" />
          <span>{crossPageText}</span>
        </div>
      )}

      {/* Main PDF Content Area */}
      <div className="flex-1 relative overflow-hidden bg-paper">
        {locateError ? (
          <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-surface">
            <AlertCircle className="h-8 w-8 text-caution mb-2" />
            <p className="text-sm font-medium text-ink">Couldn&apos;t locate passage coordinates.</p>
            <p className="text-xs text-ink-muted mt-1 max-w-sm mb-4">{locateError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="px-3 py-1.5 text-xs font-medium text-accent border border-line-strong rounded hover:bg-surface-subtle inline-flex items-center gap-1.5"
            >
              <RotateCcw size={12} />
              Try again
            </button>
          </div>
        ) : (
          <PdfLoader
            document={renditionUrl}
            workerSrc="/pdf.worker.min.mjs"
            beforeLoad={() => (
              <div className="h-full w-full flex flex-col items-center justify-center bg-sunken/40 p-8 text-center">
                <Loader2 className="h-8 w-8 text-accent animate-spin mb-3" />
                <p className="text-sm font-medium text-ink">
                  Opening page {activeQuote?.pageStart || currentPage}…
                </p>
                <p className="text-xs text-ink-muted mt-1">Loading document rendition</p>
              </div>
            )}
            errorMessage={(error) => (
              <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-surface">
                <AlertCircle className="h-8 w-8 text-danger mb-3" />
                <p className="text-sm font-medium text-ink">Couldn&apos;t open the document.</p>
                <p className="text-xs text-ink-muted mt-1 max-w-sm mb-4">
                  {error.message || "Failed to render PDF document."}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="px-3 py-1.5 text-xs font-medium text-ink border border-line-strong rounded hover:bg-surface-subtle inline-flex items-center gap-1.5"
                  >
                    <RotateCcw size={12} />
                    Try again
                  </button>
                  <a
                    href={renditionUrl}
                    download={documentName}
                    className="px-3 py-1.5 text-xs font-medium bg-accent text-on-accent rounded hover:bg-accent-hover inline-flex items-center gap-1.5"
                  >
                    <Download size={12} />
                    Download original
                  </a>
                </div>
              </div>
            )}
          >
            {(pdfDocument) => {
              if (totalPages !== pdfDocument.numPages) {
                setTotalPages(pdfDocument.numPages);
              }
              return (
                <PdfHighlighter
                  pdfDocument={pdfDocument}
                  pdfScaleValue={scale}
                  highlights={highlights}
                  utilsRef={(utils) => {
                    highlighterUtilsRef.current = utils;
                    const viewer = utils.getViewer();
                    if (viewer) {
                      const updatePage = () => {
                        if (viewer.currentPageNumber) {
                          setCurrentPage(viewer.currentPageNumber);
                        }
                      };
                      viewer.container.addEventListener("scroll", updatePage);
                    }
                  }}
                  style={{
                    height: "100%",
                    width: "100%",
                  }}
                >
                  <CustomHighlightRenderer />
                </PdfHighlighter>
              );
            }}
          </PdfLoader>
        )}
      </div>
    </aside>
  );
}
