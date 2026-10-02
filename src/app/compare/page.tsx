"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Filter,
  ArrowUpDown,
  BookOpen,
  Info,
} from "lucide-react";
import { ChangeCard, ComparisonChangeItem } from "@/components/compare/change-card";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import type { ActiveQuoteTarget } from "@/components/viewer/types";

interface DocumentItem {
  id: string;
  name: string;
  status: string;
  kind: string;
  pageCount: number;
}

interface ComparisonStats {
  totalChanges: number;
  high: number;
  medium: number;
  low: number;
  cosmetic: number;
  unchanged: number;
  added: number;
  removed: number;
  modified: number;
  moved: number;
}

interface ComparisonData {
  id: string;
  docA: { id: string; name: string };
  docB: { id: string; name: string };
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED";
  stage: string | null;
  summary: string | null;
  stats: ComparisonStats | null;
  errorMessage: string | null;
  changes: ComparisonChangeItem[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function CompareContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const olderParam = searchParams.get("older") || "";
  const newerParam = searchParams.get("newer") || "";
  const compIdParam = searchParams.get("id") || "";

  const [olderDocId, setOlderDocId] = useState(olderParam);
  const [newerDocId, setNewerDocId] = useState(newerParam);
  const [activeComparisonId, setActiveComparisonId] = useState(compIdParam);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Filters state
  const [selectedSignificances, setSelectedSignificances] = useState<string[]>([
    "HIGH",
    "MEDIUM",
    "LOW",
    "COSMETIC",
  ]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "MODIFIED",
    "MOVED",
    "ADDED",
    "REMOVED",
  ]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"significance" | "order">("significance");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Active viewer state
  const [activeViewer, setActiveViewer] = useState<{
    docId: string;
    docName: string;
    target: ActiveQuoteTarget;
  } | null>(null);

  // Fetch available documents
  const { data: docData } = useSWR<{ documents: DocumentItem[] }>(
    "/api/documents",
    fetcher
  );
  const readyDocuments = useMemo(() => {
    return (docData?.documents || []).filter((d) => d.status === "READY");
  }, [docData]);

  // Set initial doc IDs if params change
  useEffect(() => {
    if (olderParam && !olderDocId) setOlderDocId(olderParam);
    if (newerParam && !newerDocId) setNewerDocId(newerParam);
  }, [olderParam, newerParam, olderDocId, newerDocId]);

  // Comparison polling
  const { data: comparison, mutate: mutateComparison } = useSWR<ComparisonData>(
    activeComparisonId ? `/api/comparisons/${activeComparisonId}` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest?.status === "QUEUED" || latest?.status === "RUNNING" ? 1200 : 0,
    }
  );

  // Start or fetch comparison
  const handleStartComparison = async () => {
    if (!olderDocId || !newerDocId) {
      setSubmitError("Please select both an older and a newer document.");
      return;
    }
    if (olderDocId === newerDocId) {
      setSubmitError("Older and newer versions must be different documents.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docAId: olderDocId, docBId: newerDocId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to initiate comparison");
      }

      setActiveComparisonId(data.id);
      router.push(`/compare?older=${olderDocId}&newer=${newerDocId}&id=${data.id}`);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle filter helper
  const toggleSignificance = (val: string) => {
    setSelectedSignificances((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  };

  const toggleType = (val: string) => {
    setSelectedTypes((prev) =>
      prev.includes(val) ? prev.filter((t) => t !== val) : [...prev, val]
    );
  };

  // Filtered and sorted changes
  const filteredChanges = useMemo(() => {
    if (!comparison?.changes) return [];

    let list = comparison.changes.filter((c) => {
      const sigMatch = selectedSignificances.includes(c.significance.toUpperCase());
      const typeMatch = selectedTypes.includes(c.type.toUpperCase());
      const catMatch =
        selectedCategory === "all" ||
        (c.category && c.category.toLowerCase() === selectedCategory.toLowerCase());
      return sigMatch && typeMatch && catMatch;
    });

    const sigRanks: Record<string, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      COSMETIC: 0,
    };

    if (sortBy === "significance") {
      list.sort((a, b) => {
        const rA = sigRanks[a.significance.toUpperCase()] ?? 0;
        const rB = sigRanks[b.significance.toUpperCase()] ?? 0;
        return sortOrder === "desc" ? rB - rA : rA - rB;
      });
    } else {
      list.sort((a, b) => {
        return sortOrder === "desc" ? b.orderIdx - a.orderIdx : a.orderIdx - b.orderIdx;
      });
    }

    return list;
  }, [comparison?.changes, selectedSignificances, selectedTypes, selectedCategory, sortBy, sortOrder]);

  // Open viewer handler
  const handleOpenViewer = (
    docId: string,
    docName: string,
    text: string,
    start: number,
    end: number,
    label: string
  ) => {
    setActiveViewer({
      docId,
      docName,
      target: {
        quoteId: `comp-loc-${start}-${end}`,
        ref: label,
        documentId: docId,
        documentName: docName,
        text,
        currentOccurrenceIndex: 0,
        ranges: [
          {
            primary: { start, end, pageStart: 1, pageEnd: 1 },
            occurrences: [{ start, end, pageStart: 1, pageEnd: 1 }],
          },
        ],
      },
    });
  };

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* Top Header */}
      <header className="border-b border-line bg-surface sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Library</span>
            </Link>
            <span className="text-line-strong">|</span>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-accent" />
              <h1 className="font-serif text-lg font-bold text-ink">Compare Versions</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-faint hidden sm:inline">
              Clause-level differences & materiality ranking
            </span>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-6 space-y-6">
        {/* Document Selection Banner */}
        <section
          className="bg-surface rounded-xl border border-line p-5 shadow-sm space-y-4"
          aria-label="Document selection"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Older Version Picker */}
            <div className="space-y-1.5">
              <label htmlFor="older-doc-select" className="text-xs font-semibold text-ink uppercase tracking-wider block">
                Older Version (Base)
              </label>
              <select
                id="older-doc-select"
                value={olderDocId}
                onChange={(e) => setOlderDocId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-line bg-paper text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Choose older contract…</option>
                {readyDocuments.map((doc) => (
                  <option key={`older-${doc.id}`} value={doc.id}>
                    {doc.name} ({doc.pageCount} pages)
                  </option>
                ))}
              </select>
            </div>

            {/* Newer Version Picker */}
            <div className="space-y-1.5">
              <label htmlFor="newer-doc-select" className="text-xs font-semibold text-ink uppercase tracking-wider block">
                Newer Version (Updated)
              </label>
              <select
                id="newer-doc-select"
                value={newerDocId}
                onChange={(e) => setNewerDocId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-line bg-paper text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Choose newer contract…</option>
                {readyDocuments.map((doc) => (
                  <option key={`newer-${doc.id}`} value={doc.id}>
                    {doc.name} ({doc.pageCount} pages)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {submitError && (
            <div className="p-3 bg-danger-soft border border-danger/30 rounded-lg text-xs text-danger font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-line">
            <span className="text-xs text-ink-muted">
              Only READY documents can be compared. Differences are aligned at clause level.
            </span>
            <button
              type="button"
              onClick={handleStartComparison}
              disabled={isSubmitting || !olderDocId || !newerDocId}
              className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg bg-accent text-on-accent text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Preparing…</span>
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4" />
                  <span>Compare Contracts</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* Processing State */}
        {comparison && (comparison.status === "QUEUED" || comparison.status === "RUNNING") && (
          <section className="bg-surface rounded-xl border border-line p-8 text-center space-y-3">
            <Loader2 className="h-8 w-8 text-accent animate-spin mx-auto" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-ink">Analyzing Document Differences</h2>
              <p className="text-xs text-ink-muted" aria-live="polite">
                {comparison.stage || "Matching and ranking clauses…"}
              </p>
            </div>
            <div className="max-w-md mx-auto h-1.5 bg-line rounded-full overflow-hidden">
              <div className="h-full bg-accent animate-pulse w-3/4" />
            </div>
          </section>
        )}

        {/* Failed State */}
        {comparison && comparison.status === "FAILED" && (
          <section className="bg-danger-soft rounded-xl border border-danger/30 p-6 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-danger mx-auto" />
            <h2 className="text-base font-semibold text-danger">Comparison Failed</h2>
            <p className="text-xs text-ink-muted max-w-md mx-auto">
              {comparison.errorMessage || "An unexpected error occurred during clause analysis."}
            </p>
            <button
              type="button"
              onClick={handleStartComparison}
              className="h-8 px-4 text-xs font-medium bg-surface border border-line rounded text-ink hover:bg-surface-subtle"
            >
              Try Again
            </button>
          </section>
        )}

        {/* Ready State: Results */}
        {comparison && comparison.status === "READY" && (
          <div className="space-y-6">
            {/* Executive Summary Banner */}
            <section
              className="bg-surface rounded-xl border border-line p-5 shadow-sm space-y-4"
              aria-label="Comparison Summary"
            >
              <div className="space-y-2">
                <span className="text-xs font-semibold text-ink uppercase tracking-wider block">
                  Substantive Comparison Summary
                </span>
                <p className="text-sm font-serif text-ink leading-relaxed font-medium">
                  {comparison.summary}
                </p>
              </div>

              {/* Stats Pills */}
              {comparison.stats && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line text-xs font-medium">
                  <span className="px-2.5 py-1 rounded bg-danger-soft text-danger">
                    {comparison.stats.high} High Significance
                  </span>
                  <span className="px-2.5 py-1 rounded bg-caution-soft text-caution">
                    {comparison.stats.medium} Medium
                  </span>
                  <span className="px-2.5 py-1 rounded bg-slate-soft text-slate">
                    {comparison.stats.low} Low
                  </span>
                  <span className="px-2.5 py-1 rounded bg-faint-soft text-faint">
                    {comparison.stats.cosmetic} Cosmetic
                  </span>
                  <span className="px-2.5 py-1 rounded bg-verified-soft text-verified inline-flex items-center gap-1 border border-verified-line">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{comparison.stats.unchanged} clauses identical</span>
                  </span>
                </div>
              )}
            </section>

            {/* Filter and Control Bar */}
            <section className="bg-surface rounded-xl border border-line p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <Filter className="h-3.5 w-3.5 text-accent" />
                  <span>Filter Changes:</span>
                </div>

                {/* Sort dropdown */}
                <div className="flex items-center gap-2 text-xs">
                  <ArrowUpDown className="h-3.5 w-3.5 text-ink-muted" />
                  <span className="text-ink-muted">Sort:</span>
                  <select
                    value={`${sortBy}-${sortOrder}`}
                    onChange={(e) => {
                      const [sb, so] = e.target.value.split("-") as [
                        "significance" | "order",
                        "asc" | "desc"
                      ];
                      setSortBy(sb);
                      setSortOrder(so);
                    }}
                    className="h-8 px-2.5 rounded border border-line bg-paper text-xs text-ink focus:outline-none"
                  >
                    <option value="significance-desc">Most significant first</option>
                    <option value="significance-asc">Least significant first</option>
                    <option value="order-asc">Document order (v2)</option>
                    <option value="order-desc">Reverse document order</option>
                  </select>
                </div>
              </div>

              {/* Filter checkboxes */}
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-line text-xs">
                {/* Significance Checkboxes */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-ink-faint">Significance:</span>
                  {[
                    { key: "HIGH", label: "High", color: "text-danger" },
                    { key: "MEDIUM", label: "Medium", color: "text-caution" },
                    { key: "LOW", label: "Low", color: "text-slate" },
                    { key: "COSMETIC", label: "Cosmetic", color: "text-faint" },
                  ].map((s) => (
                    <label key={s.key} className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSignificances.includes(s.key)}
                        onChange={() => toggleSignificance(s.key)}
                        className="rounded border-line text-accent focus:ring-accent"
                      />
                      <span className={`font-medium ${s.color}`}>{s.label}</span>
                    </label>
                  ))}
                </div>

                <span className="text-line-strong">|</span>

                {/* Type Checkboxes */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-ink-faint">Type:</span>
                  {["MODIFIED", "MOVED", "ADDED", "REMOVED"].map((t) => (
                    <label key={t} className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(t)}
                        onChange={() => toggleType(t)}
                        className="rounded border-line text-accent focus:ring-accent"
                      />
                      <span className="text-ink-muted capitalize">
                        {t.toLowerCase()}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Changes List */}
            <section className="space-y-4" aria-label="Changes List">
              <div className="flex items-center justify-between text-xs text-ink-muted">
                <span>
                  Showing {filteredChanges.length} of {comparison.changes.length} changes
                </span>
                {comparison.stats?.unchanged ? (
                  <span className="text-verified">
                    {comparison.stats.unchanged} unchanged clauses omitted from list
                  </span>
                ) : null}
              </div>

              {filteredChanges.length === 0 ? (
                <div className="bg-surface rounded-xl border border-line p-8 text-center space-y-2">
                  <Info className="h-6 w-6 text-ink-faint mx-auto" />
                  <p className="text-sm font-medium text-ink">No changes match the selected filters.</p>
                  <p className="text-xs text-ink-muted">
                    Adjust significance or type filters above to view remaining items.
                  </p>
                </div>
              ) : (
                filteredChanges.map((change) => (
                  <ChangeCard
                    key={change.id}
                    change={change}
                    docAId={comparison.docA.id}
                    docAName={comparison.docA.name}
                    docBId={comparison.docB.id}
                    docBName={comparison.docB.name}
                    onOpenViewer={handleOpenViewer}
                  />
                ))
              )}
            </section>
          </div>
        )}
      </main>

      {/* Side-by-Side / Slide-over Document Viewer Modal */}
      {activeViewer && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex bg-ink/40 backdrop-blur-sm"
        >
          <div className="ml-auto w-full md:w-3/5 lg:w-1/2 h-full bg-paper shadow-2xl flex flex-col border-l border-line animate-in slide-in-from-right duration-200">
            <PdfViewer
              documentId={activeViewer.docId}
              documentName={activeViewer.docName}
              activeQuote={activeViewer.target}
              onClose={() => setActiveViewer(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-paper flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-accent animate-spin" />
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
