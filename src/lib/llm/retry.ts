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

/** Extract header value safely from Web API Headers, node-fetch Headers, or plain objects. */
export function getHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  // If it's a Fetch API / Web Headers instance or has a get method
  if ("get" in headers && typeof (headers as { get: unknown }).get === "function") {
    try {
      const val = (headers as { get: (k: string) => string | null }).get(name);
      if (val) return val;
    } catch {
      // ignore
    }
  }
  // Plain object / Record (case-insensitive lookup)
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && typeof v === "string") {
      return v;
    }
  }
  return null;
}

/** Extract Retry-After seconds or HTTP date from error headers. */
export function getRetryAfterMs(err: unknown): number | null {
  if (err && typeof err === "object" && "headers" in err) {
    const ra = getHeader((err as { headers: unknown }).headers, "retry-after");
    if (ra) {
      // Check if it's a number (seconds)
      const secs = parseFloat(ra);
      if (!isNaN(secs) && secs > 0) {
        return Math.min(Math.ceil(secs * 1000), MAX_DELAY_MS);
      }
      // Check if it's an HTTP date
      const dateMs = Date.parse(ra);
      if (!isNaN(dateMs)) {
        const diff = dateMs - Date.now();
        if (diff > 0) return Math.min(diff, MAX_DELAY_MS);
      }
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

/**
 * Gemini's OpenAI-compatible endpoint can return an empty content field
 * (or throw this message) when it refuses a request or the
 * response_format parameter is not supported. Treat it as transient.
 */
function isGeminiEmptyOutputError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("model output must contain") ||
      msg.includes("empty response") ||
      msg.includes("no content") ||
      msg.includes("resource has been exhausted") ||
      msg.includes("rate limit")
    );
  }
  return false;
}

function isRetryable(err: unknown): boolean {
  const status = getStatus(err);
  if (status !== null) return RETRYABLE_STATUS.has(status);
  return isNetworkError(err) || isGeminiEmptyOutputError(err);
}

/**
 * Guard: throw a retryable error when the model returns empty content.
 * Use this immediately after extracting `choices[0]?.message?.content`
 * so withRetry has a chance to recover.
 */
export function assertNonEmptyContent(
  content: string | null | undefined,
  context: string
): asserts content is string {
  if (!content || content.trim().length === 0) {
    throw Object.assign(
      new Error(
        `model output must contain either output text or tool calls [${context}]`
      ),
      { status: null } // isRetryable will match via isGeminiEmptyOutputError
    );
  }
}

export interface RetryContext {
  stage?: "extraction" | "composition" | "comparison" | "redline" | "repair";
  model?: string;
  maxAttempts?: number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/**
 * Retry an async factory up to MAX_ATTEMPTS times.
 *
 * @param fn - The async function to retry (receives attempt index 0-based).
 * @param signal - AbortSignal that cancels waiting between retries.
 * @param context - Optional metadata for safe logging and status hooks.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  signal?: AbortSignal,
  context?: RetryContext
): Promise<T> {
  const maxAttempts = context?.maxAttempts ?? MAX_ATTEMPTS;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: unknown) {
      lastErr = err;

      // If the abort signal fired, stop immediately.
      if (signal?.aborted) throw err;

      // Non-retryable error: give up immediately.
      if (!isRetryable(err)) throw err;

      // Last attempt: don't wait, just throw.
      if (attempt === maxAttempts - 1) break;

      // Compute delay: honour Retry-After, else exponential + jitter.
      const status = getStatus(err);
      const retryAfterMs = getRetryAfterMs(err);
      const baseDelay = status === 429 ? 4000 : BASE_DELAY_MS;
      const expDelay = Math.min(baseDelay * 2 ** attempt, MAX_DELAY_MS);
      const jitter = Math.random() * 0.3 * expDelay; // ±30% jitter
      const delay = Math.round(retryAfterMs ?? (expDelay + jitter));

      // Safe metadata logging (Rules I-8, I-9: NEVER log API keys or document text)
      console.warn(
        `[LLM Retry] stage: ${context?.stage || "unknown"}, model: ${
          context?.model || "configured"
        }, status: ${status ?? "network/transient"}, attempt: ${
          attempt + 1
        }/${maxAttempts}, delayMs: ${delay}`
      );

      if (context?.onRetry) {
        context.onRetry(attempt, delay, err);
      }

      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

