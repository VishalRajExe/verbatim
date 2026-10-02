import pLimit from "p-limit";
import { processDocument } from "@/lib/ingest/pipeline";

interface JobRunnerState {
  limit: ReturnType<typeof pLimit>;
  activeJobs: Set<string>;
  pendingPromises: Map<string, Promise<void>>;
}

const globalForJobs = globalThis as unknown as {
  jobRunnerState?: JobRunnerState;
};

function getRunnerState(): JobRunnerState {
  if (!globalForJobs.jobRunnerState) {
    globalForJobs.jobRunnerState = {
      limit: pLimit(1), // Concurrency 1 due to LibreOffice single-user constraints
      activeJobs: new Set(),
      pendingPromises: new Map(),
    };
  }
  return globalForJobs.jobRunnerState;
}

/**
 * Enqueues a document for background ingestion with concurrency 1.
 * Does not throw unhandled rejections into the HTTP route handler.
 */
export function enqueueDocument(documentId: string): void {
  const state = getRunnerState();

  if (state.activeJobs.has(documentId)) {
    return;
  }

  state.activeJobs.add(documentId);

  const jobPromise = state.limit(async () => {
    try {
      await processDocument(documentId);
    } catch (err) {
      console.error(`[JobRunner] Processing failed for document ${documentId}:`, err);
    } finally {
      state.activeJobs.delete(documentId);
      state.pendingPromises.delete(documentId);
    }
  });

  state.pendingPromises.set(documentId, jobPromise);
}

/**
 * Helper to wait for a document's background processing to complete (useful in tests).
 */
export async function waitForDocument(documentId: string): Promise<void> {
  const state = getRunnerState();
  const promise = state.pendingPromises.get(documentId);
  if (promise) {
    await promise;
  }
}
