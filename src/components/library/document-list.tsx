"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Calendar,
  Layers,
  MessageSquareText,
  X,
} from "lucide-react";
import { StatusPipeline, DocStatus } from "./status-pipeline";
import { DeleteConfirmDialog } from "./delete-dialog";

export interface DocumentItem {
  id: string;
  name: string;
  kind: "pdf" | "docx" | string;
  sizeBytes: number;
  status: DocStatus;
  stage: string | null;
  progress: number;
  pageCount: number | null;
  charCount: number | null;
  tokenEstimate: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: { emptyPages?: number[] } | null;
  createdAt: string;
  updatedAt: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

const MAX_DOCS = 5;

export function DocumentList({ initialData }: { initialData?: DocumentItem[] }) {
  const router = useRouter();
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // SWR polling: poll every 1500ms while any document is not READY or FAILED
  const { data, mutate } = useSWR<{ documents: DocumentItem[] }>(
    "/api/documents",
    fetcher,
    {
      fallbackData: initialData ? { documents: initialData } : undefined,
      refreshInterval: (latestData) => {
        const docs = latestData?.documents || [];
        const hasUnfinished = docs.some(
          (d) => d.status !== "READY" && d.status !== "FAILED"
        );
        return hasUnfinished ? 1500 : 0;
      },
    }
  );

  const documents = data?.documents || [];

  const handleDelete = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/documents/${docToDelete.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setSelectedIds((prev) => prev.filter((id) => id !== docToDelete.id));
        setDocToDelete(null);
        mutate();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelect = (id: string, isReady: boolean) => {
    if (!isReady) return;
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= MAX_DOCS) return prev;
      return [...prev, id];
    });
  };

  const handleAskAcross = () => {
    if (selectedIds.length < 2) return;
    router.push(`/ask?docs=${selectedIds.join(",")}`);
  };

  // Screen reader live status announcement
  const liveStatusText = documents
    .filter((d) => d.status !== "READY" && d.status !== "FAILED")
    .map((d) => `${d.name}: ${d.stage || d.status} (${d.progress}%)`)
    .join("; ");

  return (
    <div className="w-full space-y-4">
      {/* Accessible live status for screen readers */}
      <div aria-live="polite" className="sr-only">
        {liveStatusText}
      </div>

      {/* Header and Multi-document Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line">
        <h2 className="text-lg font-serif font-semibold text-ink">
          Documents{" "}
          <span className="text-xs font-sans font-normal text-ink-muted tabular-nums">
            ({documents.length})
          </span>
        </h2>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 bg-surface-subtle border border-line px-3 py-1.5 rounded-lg text-xs animate-in fade-in duration-200">
            <span className="font-medium text-ink">
              {selectedIds.length} {selectedIds.length === 1 ? "document" : "documents"} selected
            </span>

            {selectedIds.length < 2 ? (
              <span className="text-ink-muted">
                (select at least 2 to ask across)
              </span>
            ) : (
              <button
                type="button"
                onClick={handleAskAcross}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent text-on-accent font-medium rounded-md hover:bg-accent/90 transition-colors shadow-sm"
              >
                <MessageSquareText size={14} />
                <span>Ask across documents ({selectedIds.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="p-1 text-ink-muted hover:text-ink rounded transition-colors ml-1"
              title="Clear selection"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="border border-line rounded-xl p-12 text-center bg-surface space-y-3">
          <div className="w-12 h-12 rounded-full bg-surface-subtle flex items-center justify-center text-ink-muted mx-auto">
            <FileText size={24} strokeWidth={1.5} />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-serif font-semibold text-ink">No contracts uploaded yet</h3>
            <p className="text-sm text-ink-muted max-w-sm mx-auto">
              Upload a PDF or Word document above to start indexing, searching, and verifying clauses.
            </p>
          </div>
        </div>
      ) : (
        <div className="border border-line rounded-xl overflow-hidden bg-surface divide-y divide-line">
          {documents.map((doc) => {
            const isReady = doc.status === "READY";
            const isFailed = doc.status === "FAILED";
            const isSelected = selectedIds.includes(doc.id);
            const isMaxReached = selectedIds.length >= MAX_DOCS && !isSelected;
            const emptyPages = doc.warnings?.emptyPages || [];

            return (
              <div
                key={doc.id}
                className={`p-5 hover:bg-surface-subtle/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isSelected ? "bg-accent-soft/30" : ""
                }`}
              >
                {/* Selection Checkbox & Document Information */}
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="pt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isReady || isMaxReached}
                      onChange={() => toggleSelect(doc.id, isReady)}
                      title={
                        !isReady
                          ? "Only READY documents can be selected for cross-document questions"
                          : isMaxReached
                          ? `Maximum ${MAX_DOCS} documents can be selected`
                          : `Select ${doc.name}`
                      }
                      className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded ${
                          doc.kind === "pdf"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {doc.kind}
                      </span>
                      <h3 className="text-base font-semibold text-ink truncate" title={doc.name}>
                        {doc.name}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      <span className="flex items-center gap-1">
                        <Calendar size={13} className="text-ink-faint" />
                        {formatDate(doc.createdAt)}
                      </span>
                      <span>{formatBytes(doc.sizeBytes)}</span>
                      {doc.pageCount !== null && (
                        <span className="flex items-center gap-1 tabular-nums font-mono">
                          <Layers size={13} className="text-ink-faint" />
                          {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                        </span>
                      )}
                    </div>

                    {/* Empty pages warning (FR-1.5) */}
                    {emptyPages.length > 0 && (
                      <div className="pt-1">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-caution bg-caution-soft px-2.5 py-0.5 rounded border border-caution-line"
                          role="alert"
                        >
                          <AlertTriangle size={13} className="shrink-0" />
                          <span>
                            {emptyPages.length} {emptyPages.length === 1 ? "page" : "pages"} had no text and are not searchable
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Status Pipeline / Stage */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <StatusPipeline
                    status={doc.status}
                    kind={doc.kind}
                    stage={doc.stage}
                    progress={doc.progress}
                    errorCode={doc.errorCode}
                    errorMessage={doc.errorMessage}
                  />

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                    {isReady && (
                      <Link
                        href={`/documents/${doc.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-on-accent bg-accent rounded-md hover:bg-accent/90 transition-colors"
                      >
                        <span>Open</span>
                        <ExternalLink size={13} />
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={() => setDocToDelete(doc)}
                      className="p-1.5 text-ink-muted hover:text-danger hover:bg-danger-soft rounded-md transition-colors"
                      title="Delete document"
                      aria-label={`Delete ${doc.name}`}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmDialog
        isOpen={Boolean(docToDelete)}
        documentName={docToDelete?.name || ""}
        isDeleting={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setDocToDelete(null)}
      />
    </div>
  );
}
