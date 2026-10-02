import React from "react";
import { db } from "@/lib/db";
import { Dropzone } from "@/components/library/dropzone";
import { DocumentList } from "@/components/library/document-list";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  // Initial server-side query for fast initial load
  const initialDocuments = await db.document.findMany({
    select: {
      id: true,
      name: true,
      kind: true,
      sizeBytes: true,
      status: true,
      stage: true,
      progress: true,
      pageCount: true,
      charCount: true,
      tokenEstimate: true,
      errorCode: true,
      errorMessage: true,
      warnings: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const serializedDocs = initialDocuments.map((doc) => ({
    ...doc,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    warnings: doc.warnings as { emptyPages?: number[] } | null,
  }));

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* Top Header */}
      <header className="border-b border-line bg-surface sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-serif text-xl font-bold tracking-tight text-ink">
              Verbatim
            </span>
            <span className="text-line-strong">|</span>
            <span className="text-xs text-ink-muted hidden sm:inline">
              Contract analysis backed by deterministic verified quotes
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-verified-soft text-verified border border-verified-line">
              Phase 1 Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-8">
        <section className="space-y-2">
          <h1 className="text-2xl font-serif font-bold text-ink">Contract Library</h1>
          <p className="text-sm text-ink-muted max-w-2xl">
            Upload PDF or DOCX agreements. Verbatim extracts canonical page text, calculates exact
            geometric coordinates, and prepares documents for citation verification.
          </p>
        </section>

        {/* Upload Dropzone */}
        <section>
          <Dropzone onUploadSuccess={() => {}} />
        </section>

        {/* Documents Table & Status Pipeline */}
        <section>
          <DocumentList initialData={serializedDocs} />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line py-6 text-center text-xs text-ink-faint">
        <div className="max-w-5xl mx-auto px-6">
          Verbatim &bull; Strict deterministic citation verification &bull; Open application
        </div>
      </footer>
    </div>
  );
}
