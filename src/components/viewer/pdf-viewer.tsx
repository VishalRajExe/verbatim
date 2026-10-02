"use client";

import dynamic from "next/dynamic";
import React from "react";
import type { ActiveQuoteTarget } from "./types";
import { Loader2 } from "lucide-react";

interface PdfViewerProps {
  documentId: string;
  documentName: string;
  activeQuote: ActiveQuoteTarget | null;
  onClose: () => void;
  onChangeOccurrence?: (newIndex: number) => void;
}

const DynamicViewerInner = dynamic(
  () => import("./pdf-viewer-inner"),
  {
    ssr: false,
    loading: () => (
      <aside
        aria-label="Document viewer loading"
        className="flex flex-col h-full w-full bg-paper border-l border-line items-center justify-center p-8 text-center"
      >
        <Loader2 className="h-8 w-8 text-accent animate-spin mb-3" />
        <p className="text-sm font-medium text-ink">Opening document viewer…</p>
        <p className="text-xs text-ink-muted mt-1">Initializing PDF engine</p>
      </aside>
    ),
  }
);

export function PdfViewer(props: PdfViewerProps) {
  return <DynamicViewerInner {...props} />;
}
