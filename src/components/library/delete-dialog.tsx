"use client";

import React from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  documentName: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  isOpen,
  documentName,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-surface border border-line rounded-xl shadow-lg p-6 space-y-4">
        <button
          onClick={onCancel}
          disabled={isDeleting}
          className="absolute top-4 right-4 text-ink-muted hover:text-ink transition-colors"
        >
          <X size={18} />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-danger-soft flex items-center justify-center text-danger shrink-0 mt-0.5">
            <Trash2 size={20} strokeWidth={1.75} />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-semibold text-ink font-serif">Delete document</h3>
            <p className="text-sm text-ink-muted">
              Are you sure you want to delete{" "}
              <strong className="text-ink font-medium">&ldquo;{documentName}&rdquo;</strong>? This will permanently
              remove the document, its canonical text, and all associated data.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-ink bg-surface border border-line-strong rounded-md hover:bg-surface-subtle transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-on-accent bg-danger rounded-md hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isDeleting ? "Deleting..." : "Delete document"}
          </button>
        </div>
      </div>
    </div>
  );
}
