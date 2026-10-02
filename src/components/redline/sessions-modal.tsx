"use client";

import React from "react";
import {
  History,
  X,
  CheckCircle2,
  AlertCircle,
  Download,
  FileEdit,
  ArrowRight,
  FileText,
  Calendar,
  Eye,
} from "lucide-react";
import type { RedlineSession } from "./redline-panel";

interface SessionsModalProps {
  isOpen: boolean;
  sessions: RedlineSession[];
  currentSessionId?: string;
  activeSessionId?: string;
  documentName?: string;
  onClose: () => void;
  onOpenSession: (session: RedlineSession) => void;
  onViewDocx?: (redlineId: string) => void;
  onViewRedlined?: (session: RedlineSession) => void;
  onDownloadDocx?: (sessionId: string) => void;
}

export function SessionsModal({
  isOpen,
  sessions,
  currentSessionId,
  activeSessionId,
  documentName,
  onClose,
  onOpenSession,
  onViewDocx,
  onViewRedlined,
  onDownloadDocx,
}: SessionsModalProps) {
  if (!isOpen) return null;

  const effectiveActiveId = activeSessionId || currentSessionId;

  // Group sessions by date: Today, Yesterday, or formatted date string
  const groupedSessions = sessions.reduce<Record<string, RedlineSession[]>>(
    (acc, session) => {
      const date = new Date(session.createdAt);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      let groupKey = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      if (date.toDateString() === today.toDateString()) {
        groupKey = "Today";
      } else if (date.toDateString() === yesterday.toDateString()) {
        groupKey = "Yesterday";
      }

      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(session);
      return acc;
    },
    {}
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-accent-soft text-accent flex items-center justify-center">
              <History size={17} />
            </div>
            <div>
              <h2 className="font-serif text-base font-semibold text-ink">
                Redline Sessions
              </h2>
              <p className="text-xs text-ink-muted">
                {sessions.length} {sessions.length === 1 ? "session" : "sessions"} for {documentName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-muted hover:text-ink rounded transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Session List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-paper/30">
          {sessions.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <div className="w-12 h-12 rounded-full bg-sunken flex items-center justify-center mx-auto text-ink-muted">
                <FileEdit size={22} />
              </div>
              <h3 className="font-serif text-sm font-semibold text-ink">
                No Redline Sessions Yet
              </h3>
              <p className="text-xs text-ink-muted max-w-xs mx-auto">
                Propose your first redline edit to start a new tracked-change session.
              </p>
            </div>
          ) : (
            Object.entries(groupedSessions).map(([dateLabel, groupSessions]) => (
              <div key={dateLabel} className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink uppercase tracking-wider">
                  <Calendar size={13} className="text-ink-muted" />
                  <span>{dateLabel}</span>
                </div>

                <div className="space-y-3">
                  {groupSessions.map((session) => {
                    const isActive = session.id === effectiveActiveId;
                    const edits = session.edits || [];
                    const proposedCount = edits.filter((e) => e.verified).length;
                    const droppedCount = edits.filter((e) => !e.verified).length;
                    const appliedCount = session.status === "APPLIED" ? proposedCount : 0;
                    const docName = (session as { documentName?: string }).documentName || documentName || "Contract.docx";
                    const timeStr = new Date(session.createdAt).toLocaleTimeString(
                      "en-US",
                      { hour: "numeric", minute: "2-digit" }
                    );

                    return (
                      <div
                        key={session.id}
                        className={`bg-surface border rounded-xl p-4 sm:p-5 shadow-xs transition-all space-y-3 ${
                          isActive
                            ? "border-accent ring-1 ring-accent/20 bg-accent-soft/10"
                            : "border-line hover:border-accent/40"
                        }`}
                      >
                        {/* Top: Instruction and Status Badge */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-ink-muted bg-sunken px-1.5 py-0.5 rounded border border-line">
                                #{session.id.slice(-6)}
                              </span>
                              <span className="text-xs text-ink-muted">{timeStr}</span>
                              {isActive && (
                                <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded">
                                  Current
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-medium text-ink font-serif leading-snug">
                              &ldquo;{session.instruction}&rdquo;
                            </h4>
                          </div>

                          {/* Status Badge */}
                          <div className="shrink-0">
                            {session.status === "APPLIED" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-verified bg-verified-soft px-2 py-1 rounded-md border border-verified/20">
                                <CheckCircle2 size={12} />
                                <span>Applied</span>
                              </span>
                            ) : session.status === "FAILED" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger bg-danger-soft px-2 py-1 rounded-md border border-danger/20">
                                <AlertCircle size={12} />
                                <span>Failed</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-caution bg-caution-soft px-2 py-1 rounded-md border border-caution/20">
                                <FileEdit size={12} />
                                <span>Proposed ({proposedCount} ready)</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Mid: Stats summary */}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted pt-1 border-t border-line/50">
                          <span>
                            <strong className="text-ink">{proposedCount}</strong> proposed
                          </span>
                          <span>•</span>
                          <span>
                            <strong className="text-ink">{appliedCount}</strong> applied
                          </span>
                          {droppedCount > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-caution">
                                <strong>{droppedCount}</strong> dropped
                              </span>
                            </>
                          )}
                          <span>•</span>
                          <span className="truncate max-w-[200px]" title={docName}>
                            {docName}
                          </span>
                        </div>

                        {/* Bottom: Action Buttons */}
                        <div className="flex items-center justify-between pt-2">
                          <div className="flex items-center gap-2">
                            {session.status === "APPLIED" && (onViewRedlined || onViewDocx) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (onViewRedlined) onViewRedlined(session);
                                  else if (onViewDocx) onViewDocx(session.id);
                                  onClose();
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-line bg-surface text-ink hover:bg-paper transition-colors"
                              >
                                <Eye size={13} className="text-accent" />
                                <span>View Redlined</span>
                              </button>
                            )}

                            {session.status === "APPLIED" && (
                              <a
                                href={`/api/redlines/${session.id}/download`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-line bg-surface text-ink hover:bg-paper transition-colors"
                                download
                              >
                                <Download size={13} />
                                <span>Download DOCX</span>
                              </a>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              onOpenSession(session);
                              onClose();
                            }}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors shadow-xs ${
                              isActive
                                ? "bg-accent text-on-accent hover:bg-accent-hover"
                                : "bg-accent text-on-accent hover:bg-accent-hover"
                            }`}
                          >
                            <span>{isActive ? "Inspect Session" : "Open Session"}</span>
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-line bg-surface shrink-0 text-xs text-ink-muted">
          <span>Sessions persist across browser refreshes</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-md border border-line hover:bg-paper text-ink transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
