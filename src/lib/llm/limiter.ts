/**
 * Concurrency limiter for LLM calls.
 *
 * Uses p-limit with LLM_MAX_CONCURRENCY (default 2) so we don't blast
 * the Gemini free tier. The singleton is stored on globalThis so Next.js
 * hot reloads don't create duplicate limiters.
 */
import pLimit from "p-limit";
import { env } from "@/lib/env";

type Limiter = ReturnType<typeof pLimit>;

// Attach to globalThis to survive Next.js hot reloads in development.
const g = globalThis as typeof globalThis & { __llmLimiter?: Limiter };
if (!g.__llmLimiter) {
  g.__llmLimiter = pLimit(env.LLM_MAX_CONCURRENCY);
}

export const llmLimiter: Limiter = g.__llmLimiter;

/**
 * Await a delay; resolves early if the AbortSignal fires.
 * Used by the retry module between attempts.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}
