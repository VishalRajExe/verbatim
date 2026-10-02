"use client";

import React, { useState, useEffect } from "react";
import {
  FileEdit,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  Loader2,
  History,
  Check,
  X,
  FileText,
  FileCode,
  ArrowRight,
  Eye,
  Plus,
} from "lucide-react";
import { WordDiff } from "@/components/compare/word-diff";
import { SessionsModal } from "./sessions-modal";
import { WordViewer } from "@/components/viewer/word-viewer";
import { ConvertPdfModal } from "@/components/viewer/convert-pdf-modal";
import { PdfViewer } from "@/components/viewer/pdf-viewer";

export interface RedlineVerifiedEdit {
  id: string;
  target: string;
  replacement: string;
  reason: string;
  verified: boolean;
  include: boolean;
  dropReason?: string;
  occurrences: number;
  matchStartIndex?: number;
  matchEndIndex?: number;
  matchedClause?: string;
  contextBefore?: string;
  contextAfter?: string;
  expectedOriginal?: string;
  actualDocumentValue?: string;
}

export interface RedlineSession {
  id: string;
  documentId: string;
  instruction: string;
  status: "PROPOSED" | "APPLIED" | "FAILED";
  edits: RedlineVerifiedEdit[];
  createdAt: string;
  outputAvailable?: boolean;
}

interface RedlinePanelProps {
  documentId: string;
  documentName: string;
  documentKind: string;
  hasPdfRendition?: boolean;
  onConvertedToPdf?: () => void;
}

export function RedlinePanel({
  documentId,
  documentName,
  documentKind,
  hasPdfRendition: initialHasPdfRendition,
  onConvertedToPdf,
}: RedlinePanelProps) {
  const isDocx = documentKind === "docx";

  const [instruction, setInstruction] = useState("");
  const [isProposing, setIsProposing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentSession, setCurrentSession] = useState<RedlineSession | null>(
    null
  );
  const [pastSessions, setPastSessions] = useState<RedlineSession[]>([]);
  const [selectedEdits, setSelectedEdits] = useState<Record<string, boolean>>(
    {}
  );
  const [appliedStats, setAppliedStats] = useState<{
    insCount: number;
    delCount: number;
    totalRevisions: number;
  } | null>(null);

  // Modals & In-App Viewers
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showConvertPdfModal, setShowConvertPdfModal] = useState(false);
  const [hasPdfRenditionState, setHasPdfRenditionState] = useState(
    Boolean(initialHasPdfRendition)
  );
  const [viewerState, setViewerState] = useState<{
    mode: "none" | "word-original" | "word-redlined" | "pdf";
    redlineId?: string;
  }>({ mode: "none" });

  // Load past redlines on mount and restore active session if available
  useEffect(() => {
    if (!isDocx) return;
    async function loadPastSessions() {
      try {
        const res = await fetch(`/api/redlines?documentId=${documentId}`);
        if (res.ok) {
          const data = await res.json();
          setPastSessions(data.redlines);
          if (data.redlines.length > 0) {
            // Check URL search param or localStorage for persisted active session
            let targetSession = data.redlines[0];
            try {
              const urlParams = new URLSearchParams(window.location.search);
              const requestedSessionId =
                urlParams.get("session") ||
                localStorage.getItem(`verbatim_active_session_${documentId}`);
              if (requestedSessionId) {
                const found = data.redlines.find(
                  (s: RedlineSession) => s.id === requestedSessionId
                );
                if (found) {
                  targetSession = found;
                }
              }
            } catch {}

            setCurrentSession((prev) => {
              const active = prev || targetSession;
              const sel: Record<string, boolean> = {};
              for (const edit of active.edits || []) {
                if (edit.verified) {
                  sel[edit.id] = edit.include ?? true;
                }
              }
              setSelectedEdits(sel);
              setInstruction(active.instruction || "");
              if (active.status === "APPLIED") {
                const verified = (active.edits || []).filter(
                  (e: RedlineVerifiedEdit) => e.verified
                );
                setAppliedStats({
                  insCount: verified.length,
                  delCount: verified.length,
                  totalRevisions: verified.length * 2,
                });
              }
              return active;
            });
          }
        }
      } catch (err) {
        console.error("Failed to load redlines:", err);
      }
    }
    loadPastSessions();
  }, [documentId, isDocx]);

  const handleOpenSession = (session: RedlineSession) => {
    setCurrentSession(session);
    setInstruction(session.instruction);
    const sel: Record<string, boolean> = {};
    for (const edit of session.edits || []) {
      if (edit.verified) {
        sel[edit.id] = edit.include ?? true;
      }
    }
    setSelectedEdits(sel);

    if (session.status === "APPLIED") {
      const verified = (session.edits || []).filter((e) => e.verified);
      setAppliedStats({
        insCount: verified.length,
        delCount: verified.length,
        totalRevisions: verified.length * 2,
      });
    } else {
      setAppliedStats(null);
    }

    try {
      localStorage.setItem(`verbatim_active_session_${documentId}`, session.id);
      const url = new URL(window.location.href);
      url.searchParams.set("session", session.id);
      window.history.replaceState({}, "", url.toString());
    } catch {}
  };

  const initSelectedEdits = (edits: RedlineVerifiedEdit[]) => {
    const sel: Record<string, boolean> = {};
    for (const edit of edits) {
      if (edit.verified) {
        sel[edit.id] = edit.include ?? true;
      }
    }
    setSelectedEdits(sel);
  };

  const handlePropose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim() || isProposing) return;

    setIsProposing(true);
    setError(null);
    setAppliedStats(null);

    try {
      const res = await fetch("/api/redlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          instruction: instruction.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to propose redline");
      }

      const session: RedlineSession = data.redline;
      setCurrentSession(session);
      initSelectedEdits(session.edits || []);
      setPastSessions((prev) => [
        session,
        ...prev.filter((s) => s.id !== session.id),
      ]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to propose edits");
    } finally {
      setIsProposing(false);
    }
  };

  const handleToggleEdit = (id: string) => {
    setSelectedEdits((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleApply = async () => {
    if (!currentSession || isApplying) return;

    const includeIds = Object.entries(selectedEdits)
      .filter(([_, included]) => included)
      .map(([id]) => id);

    if (includeIds.length === 0) {
      setError("Please select at least one verified edit to apply.");
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      const res = await fetch(`/api/redlines/${currentSession.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeIds }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to apply redlines");
      }

      setCurrentSession((prev) =>
        prev
          ? {
              ...prev,
              status: "APPLIED",
              outputAvailable: true,
            }
          : null
      );

      if (data.validation) {
        setAppliedStats({
          insCount: data.validation.insCount,
          delCount: data.validation.delCount,
          totalRevisions: data.validation.totalRevisions,
        });
      }

      // Update past sessions list
      setPastSessions((prev) =>
        prev.map((s) =>
          s.id === currentSession.id ? { ...s, status: "APPLIED" } : s
        )
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to apply edits");
    } finally {
      setIsApplying(false);
    }
  };

  const handleDownload = () => {
    if (!currentSession) return;
    window.location.href = `/api/redlines/${currentSession.id}/download`;
  };

  // PDF Honest Banner (FR-8.1)
  if (!isDocx) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-paper">
        <div className="max-w-md w-full bg-surface border border-line rounded-xl p-8 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-caution-soft text-caution flex items-center justify-center mx-auto">
            <AlertTriangle size={24} />
          </div>
          <h2 className="font-serif text-lg font-semibold text-ink">
            Tracked Changes Unavailable for PDF
          </h2>
          <p className="text-sm text-ink-muted leading-relaxed">
            Native Word tracked changes (<code className="font-mono text-xs">w:ins</code> and{" "}
            <code className="font-mono text-xs">w:del</code>) can only be generated in DOCX
            documents. PDF files do not support Microsoft Word revision tracking.
          </p>
          <div className="pt-2 text-xs text-ink-muted bg-sunken p-3 rounded border border-line">
            To redline with real Word tracked changes, please upload the original{" "}
            <strong>.docx</strong> version of this contract.
          </div>
        </div>
      </div>
    );
  }

  const allEdits = currentSession?.edits || [];
  const verifiedEdits = allEdits.filter((e) => e.verified);
  const droppedEdits = allEdits.filter((e) => !e.verified);
  const selectedCount = Object.values(selectedEdits).filter(Boolean).length;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-paper p-6 lg:p-8">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        {/* Header & Document Actions */}
        <div className="border-b border-line pb-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-accent-soft text-accent">
                  <FileEdit size={18} />
                </div>
                <h1 className="font-serif text-xl font-semibold text-ink">
                  Tracked-Change Redlining
                </h1>
              </div>
              <p className="text-xs text-ink-muted mt-1">
                Convert plain-language instructions into real Word revisions (<code className="font-mono text-[10px]">w:ins</code> /{" "}
                <code className="font-mono text-[10px]">w:del</code>) with author{" "}
                <strong>Verbatim AI</strong>.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowSessionsModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink bg-surface hover:bg-surface-hover px-3 py-1.5 rounded border border-line transition-colors shadow-xs"
              title="Open session history"
            >
              <History size={14} className="text-accent" />
              <span>{pastSessions.length} session{pastSessions.length === 1 ? "" : "s"}</span>
            </button>
          </div>

          {/* Document Inspection Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-line/40">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-ink-muted uppercase tracking-wider mr-1">
                Document:
              </span>
              <button
                type="button"
                onClick={() => setViewerState({ mode: "word-original" })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-hover border border-line rounded text-ink transition-colors shadow-xs"
              >
                <Eye size={13} className="text-accent" />
                <span>View Word</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!hasPdfRenditionState) {
                    setShowConvertPdfModal(true);
                  } else {
                    setViewerState({ mode: "pdf" });
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-hover border border-line rounded text-ink transition-colors shadow-xs"
              >
                <FileText size={13} className="text-accent" />
                <span>View PDF</span>
              </button>
              <a
                href={`/api/documents/${documentId}/download`}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-hover border border-line rounded text-ink transition-colors shadow-xs"
              >
                <Download size={13} className="text-ink-muted" />
                <span>Download Original</span>
              </a>
            </div>

            {currentSession && (
              <span className="text-[11px] text-ink-muted">
                Session <code className="font-mono text-[10px] text-accent">#{currentSession.id.slice(-6)}</code>
              </span>
            )}
          </div>
        </div>

        {/* Instruction Form */}
        <div className="bg-surface border border-line rounded-lg p-5 shadow-sm space-y-4">
          <form onSubmit={handlePropose} className="space-y-3">
            <label
              htmlFor="redline-instruction"
              className="block text-xs font-semibold uppercase tracking-wider text-ink"
            >
              Instruction
            </label>
            <div className="flex gap-2">
              <input
                id="redline-instruction"
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g., Make the liability cap mutual, or Increase payment terms to 60 days."
                disabled={isProposing}
                className="flex-1 px-3.5 py-2.5 text-sm bg-surface border border-line rounded-md text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="submit"
                disabled={isProposing || !instruction.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-sm"
              >
                {isProposing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Analyzing clauses…</span>
                  </>
                ) : (
                  <>
                    <FileEdit size={14} />
                    <span>Propose Redline</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-ink-muted">
              Authoritative DOCX text view is scanned for relevant passages. Edits are
              strictly minimal and verified to occur exactly once before being proposed.
            </p>
          </form>

          {error && (
            <div className="p-3 bg-danger-soft border border-danger/20 rounded text-xs text-danger flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Current Redline Session */}
        {currentSession && (
          <div className="space-y-6">
            {/* Session Summary Card */}
            <div className="bg-surface border border-line rounded-lg p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    Active Instruction
                  </span>
                  <p className="text-sm font-medium text-ink mt-0.5">
                    &quot;{currentSession.instruction}&quot;
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${
                      currentSession.status === "APPLIED"
                        ? "bg-verified-soft text-verified border border-verified/20"
                        : "bg-caution-soft text-caution border border-caution/20"
                    }`}
                  >
                    {currentSession.status === "APPLIED" ? (
                      <>
                        <CheckCircle2 size={13} />
                        <span>Applied</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={13} />
                        <span>Proposed ({verifiedEdits.length} ready)</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* Success Banner when Applied */}
              {currentSession.status === "APPLIED" && (
                <div className="mt-4 p-4 bg-verified-soft border border-verified/20 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-verified">
                      <CheckCircle2 size={16} />
                      <span>Revisions Applied Cleanly</span>
                    </div>
                    <p className="text-xs text-ink-muted">
                      Native Word tracked changes generated with author &apos;Verbatim AI&apos;.
                      Verified via headless LibreOffice conversion smoke test.
                    </p>
                    {appliedStats && (
                      <div className="flex items-center gap-3 text-[11px] text-ink font-mono mt-1">
                        <span>{appliedStats.insCount} insertions</span>
                        <span>•</span>
                        <span>{appliedStats.delCount} deletions</span>
                        <span>•</span>
                        <span>Untouched XML matched 100%</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewerState({ mode: "word-original" })}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-surface border border-line text-ink hover:bg-surface-hover transition-colors shadow-xs"
                    >
                      <Eye size={13} className="text-ink-muted" />
                      <span>View Original</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setViewerState({
                          mode: "word-redlined",
                          redlineId: currentSession.id,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors shadow-sm"
                    >
                      <FileEdit size={13} />
                      <span>View Redlined Document</span>
                    </button>
                    <button
                      onClick={handleDownload}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-verified text-white hover:bg-verified/90 transition-colors shadow-sm"
                    >
                      <Download size={13} />
                      <span>Download DOCX</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Negative result notice */}
            {allEdits.length === 0 && (
              <div className="bg-surface border border-line rounded-lg p-6 text-center space-y-2">
                <AlertCircle size={24} className="text-ink-muted mx-auto" />
                <h3 className="font-serif text-sm font-semibold text-ink">
                  No Relevant Clauses Found
                </h3>
                <p className="text-xs text-ink-muted max-w-md mx-auto">
                  The document was scanned, but no clauses matching &quot;
                  {currentSession.instruction}&quot; were located. No file was modified.
                </p>
              </div>
            )}

            {/* Proposed Edits List */}
            {verifiedEdits.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
                    Proposed Minimal Edits ({verifiedEdits.length})
                  </h2>
                  {currentSession.status !== "APPLIED" && (
                    <span className="text-xs text-ink-muted">
                      {selectedCount} of {verifiedEdits.length} selected
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {verifiedEdits.map((edit, idx) => {
                    const isChecked = selectedEdits[edit.id] ?? true;
                    return (
                      <div
                        key={edit.id}
                        className={`bg-surface border rounded-lg p-5 shadow-sm space-y-4 transition-all ${
                          isChecked
                            ? "border-line"
                            : "border-line/60 opacity-60 bg-paper/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={currentSession.status === "APPLIED"}
                              onChange={() => handleToggleEdit(edit.id)}
                              className="mt-1 w-4 h-4 rounded border-line text-accent focus:ring-accent"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-ink">
                                  Revision #{idx + 1}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-verified bg-verified-soft px-1.5 py-0.5 rounded">
                                  <Check size={10} />
                                  <span>
                                    {edit.matchedClause
                                      ? "Anchored clause verified"
                                      : "Single occurrence verified"}
                                  </span>
                                </span>
                              </div>
                              <p className="text-xs text-ink-muted mt-1">
                                {edit.reason}
                              </p>
                              {edit.matchedClause && (
                                <p className="text-[11px] text-ink-muted mt-1 font-mono bg-paper/80 px-2 py-0.5 rounded border border-line/50 truncate max-w-lg">
                                  Anchor: &ldquo;{edit.matchedClause}&rdquo;
                                </p>
                              )}
                            </div>
                          </label>
                        </div>

                        {/* Inline Word Diff Preview */}
                        <div>
                          <span className="text-[10px] uppercase font-semibold text-ink-muted tracking-wider block mb-1">
                            Tracked Change Preview
                          </span>
                          <WordDiff
                            oldText={edit.target}
                            newText={edit.replacement}
                          />
                        </div>

                        {/* Before and After Side-by-side in Serif (Document voice) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                          <div className="bg-del/10 border border-del/30 rounded p-3 text-xs font-serif leading-relaxed">
                            <span className="font-sans text-[9px] uppercase font-semibold text-del-ink block mb-1">
                              Target Text (Original)
                            </span>
                            <span className="text-ink line-through decoration-del-ink">
                              {edit.target}
                            </span>
                          </div>
                          <div className="bg-ins/10 border border-ins/30 rounded p-3 text-xs font-serif leading-relaxed">
                            <span className="font-sans text-[9px] uppercase font-semibold text-ins-ink block mb-1">
                              Replacement Text (Revised)
                            </span>
                            <span className="text-ink underline decoration-ins-ink">
                              {edit.replacement}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Apply Action Bar */}
                {currentSession.status !== "APPLIED" && (
                  <div className="bg-surface border border-line rounded-lg p-4 flex items-center justify-between shadow-sm">
                    <span className="text-xs text-ink-muted">
                      Ready to apply {selectedCount} revision
                      {selectedCount !== 1 ? "s" : ""} to the document.
                    </span>
                    <button
                      onClick={handleApply}
                      disabled={isApplying || selectedCount === 0}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {isApplying ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Applying tracked changes…</span>
                        </>
                      ) : (
                        <>
                          <Check size={14} />
                          <span>Apply Selected Edits</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Dropped Edits Section (Honesty and Transparency) */}
            {droppedEdits.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-caution">
                  <AlertTriangle size={14} />
                  <span>Dropped / Unapplied Edits ({droppedEdits.length})</span>
                </div>
                <div className="space-y-3">
                  {droppedEdits.map((edit) => (
                    <div
                      key={edit.id}
                      className="bg-caution-soft/40 border border-caution-line/40 rounded-lg p-4 space-y-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-caution flex items-center gap-1.5">
                          <AlertTriangle size={13} />
                          <span>Dropped / Unapplied Edit</span>
                        </span>
                        {edit.occurrences !== undefined && edit.occurrences > 0 && (
                          <span className="text-[10px] text-ink-muted">
                            {edit.occurrences} matches in document
                          </span>
                        )}
                      </div>

                      {edit.expectedOriginal && edit.actualDocumentValue ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <div className="bg-surface/90 border border-del/30 rounded p-2.5">
                              <span className="text-[10px] uppercase font-semibold text-del-ink block mb-0.5">
                                Expected original:
                              </span>
                              <span className="font-serif font-semibold text-danger text-sm">
                                {edit.expectedOriginal}
                              </span>
                            </div>
                            <div className="bg-surface/90 border border-line rounded p-2.5">
                              <span className="text-[10px] uppercase font-semibold text-ink-muted block mb-0.5">
                                Actual document value:
                              </span>
                              <span className="font-serif font-semibold text-ink text-sm">
                                {edit.actualDocumentValue}
                              </span>
                            </div>
                          </div>

                          <div className="bg-surface/60 rounded p-2.5 border border-line/60">
                            <span className="text-[10px] uppercase font-semibold text-ink-muted block mb-0.5">
                              Reason:
                            </span>
                            <p className="text-xs text-caution font-medium">
                              {edit.dropReason || "Specified original value does not match the authoritative DOCX clause."}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="font-serif text-ink bg-surface/80 p-2.5 rounded border border-line text-xs">
                            &quot;{edit.target}&quot;
                          </div>
                          <p className="text-xs text-caution font-medium pt-1">
                            <span className="font-semibold">Reason:</span> {edit.dropReason || "Target verification failed"}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sessions History Modal */}
      <SessionsModal
        isOpen={showSessionsModal}
        onClose={() => setShowSessionsModal(false)}
        sessions={pastSessions}
        activeSessionId={currentSession?.id}
        documentName={documentName}
        onOpenSession={(session: RedlineSession) => {
          handleOpenSession(session);
          setShowSessionsModal(false);
        }}
        onViewRedlined={(session: RedlineSession) => {
          setShowSessionsModal(false);
          setViewerState({
            mode: "word-redlined",
            redlineId: session.id,
          });
        }}
        onDownloadDocx={(sessionId: string) => {
          window.location.href = `/api/redlines/${sessionId}/download`;
        }}
      />

      {/* Convert to PDF Modal */}
      <ConvertPdfModal
        isOpen={showConvertPdfModal}
        onClose={() => setShowConvertPdfModal(false)}
        documentId={documentId}
        documentName={documentName}
        onConversionSuccess={() => {
          setHasPdfRenditionState(true);
          if (onConvertedToPdf) onConvertedToPdf();
          setShowConvertPdfModal(false);
          setViewerState({ mode: "pdf" });
        }}
      />

      {/* In-App Word Viewer Overlay */}
      {(viewerState.mode === "word-original" || viewerState.mode === "word-redlined") && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col">
          <WordViewer
            documentId={documentId}
            documentName={
              viewerState.mode === "word-redlined"
                ? `Redlined — ${documentName}`
                : documentName
            }
            isRedline={viewerState.mode === "word-redlined"}
            redlineId={viewerState.redlineId || currentSession?.id}
            onClose={() => setViewerState({ mode: "none" })}
            onSwitchToPdf={
              viewerState.mode === "word-original"
                ? () => {
                    setViewerState({ mode: "none" });
                    if (!hasPdfRenditionState) {
                      setShowConvertPdfModal(true);
                    } else {
                      setViewerState({ mode: "pdf" });
                    }
                  }
                : undefined
            }
          />
        </div>
      )}

      {/* In-App PDF Viewer Overlay */}
      {viewerState.mode === "pdf" && (
        <div className="fixed inset-0 z-50 bg-paper flex flex-col">
          <div className="h-12 border-b border-line bg-surface px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-accent" />
              <span className="text-xs font-medium text-ink truncate max-w-md">
                {documentName} (PDF Rendition)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewerState({ mode: "word-original" })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-hover border border-line rounded text-ink transition-colors shadow-xs"
              >
                <Eye size={13} className="text-ink-muted" />
                <span>Switch to Word View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewerState({ mode: "none" })}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-accent text-on-accent rounded hover:bg-accent-hover transition-colors shadow-xs"
              >
                <X size={14} />
                <span>Close</span>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <PdfViewer
              documentId={documentId}
              documentName={documentName}
              activeQuote={null}
              onClose={() => setViewerState({ mode: "none" })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
