import pLimit from "p-limit";
import { processDocument } from "@/lib/ingest/pipeline";
import { processComparison } from "@/lib/compare/service";

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
 * Enqueues a comparison job for background processing.
 */
export function enqueueComparison(comparisonId: string): void {
  const state = getRunnerState();

  if (state.activeJobs.has(`comp-${comparisonId}`)) {
    return;
  }

  state.activeJobs.add(`comp-${comparisonId}`);

  const jobPromise = state.limit(async () => {
    try {
      await processComparison(comparisonId);
    } catch (err) {
      console.error(`[JobRunner] Processing failed for comparison ${comparisonId}:`, err);
    } finally {
      state.activeJobs.delete(`comp-${comparisonId}`);
      state.pendingPromises.delete(`comp-${comparisonId}`);
    }
  });

  state.pendingPromises.set(`comp-${comparisonId}`, jobPromise);
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

/**
 * Helper to wait for a comparison job to complete (useful in tests).
 */
export async function waitForComparison(comparisonId: string): Promise<void> {
  const state = getRunnerState();
  const promise = state.pendingPromises.get(`comp-${comparisonId}`);
  if (promise) {
    await promise;
  }
}
