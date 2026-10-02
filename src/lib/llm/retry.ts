/**
 * Retry wrapper for LLM calls.
 *
 * Retries on: HTTP 429, 500, 503, and network errors.
 * Maximum 4 attempts with exponential backoff + jitter.
 * Respects the Retry-After header when present (Rules section 4, point 6).
 *
 * A failed attempt (after all retries) throws the last error so callers
 * can decide whether it affects coverage or terminates the request.
 */

import { sleep } from "@/lib/llm/limiter";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/** HTTP status codes that are retryable. */
const RETRYABLE_STATUS = new Set([429, 500, 503]);

/** Extract the OpenAI-SDK error status, if any. */
function getStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

/** Extract Retry-After seconds from OpenAI SDK error headers. */
function getRetryAfterMs(err: unknown): number | null {
  if (err && typeof err === "object" && "headers" in err) {
    const h = (err as { headers: unknown }).headers;
    if (h && typeof h === "object" && "retry-after" in h) {
      const ra = (h as Record<string, unknown>)["retry-after"];
      const secs = typeof ra === "string" ? parseFloat(ra) : NaN;
      if (!isNaN(secs) && secs > 0) return Math.min(secs * 1000, MAX_DELAY_MS);
    }
  }
  return null;
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("etimedout") ||
      msg.includes("network error")
    );
  }
  return false;
}

function isRetryable(err: unknown): boolean {
  const status = getStatus(err);
  if (status !== null) return RETRYABLE_STATUS.has(status);
  return isNetworkError(err);
}

/**
 * Retry an async factory up to MAX_ATTEMPTS times.
 *
 * @param fn - The async function to retry (receives attempt index 0-based).
 * @param signal - AbortSignal that cancels waiting between retries.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: unknown) {
      lastErr = err;

      // If the abort signal fired, stop immediately.
      if (signal?.aborted) throw err;

      // Non-retryable error: give up immediately.
      if (!isRetryable(err)) throw err;

      // Last attempt: don't wait, just throw.
      if (attempt === MAX_ATTEMPTS - 1) break;

      // Compute delay: honour Retry-After, else exponential + jitter.
      const retryAfterMs = getRetryAfterMs(err);
      const expDelay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      const jitter = Math.random() * 0.3 * expDelay; // ±30% jitter
      const delay = retryAfterMs ?? expDelay + jitter;

      await sleep(delay, signal);
    }
  }
  throw lastErr;
}
