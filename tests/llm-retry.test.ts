import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "@/lib/llm/retry";
import * as limiter from "@/lib/llm/limiter";

describe("Phase 3 - withRetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP 429 and succeeds on second attempt", async () => {
    vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const error429 = { status: 429, message: "Rate limit exceeded" };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(limiter.sleep).toHaveBeenCalledTimes(1);
  });

  it("respects Retry-After header in seconds", async () => {
    const sleepSpy = vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const errorWithHeader = {
      status: 429,
      headers: { "retry-after": "5" },
    };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(errorWithHeader)
      .mockResolvedValueOnce("done");

    const result = await withRetry(fn);
    expect(result).toBe("done");
    expect(sleepSpy).toHaveBeenCalledWith(5000, undefined);
  });

  it("fails fast on non-retryable 400 error without sleeping", async () => {
    const sleepSpy = vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const error400 = { status: 400, message: "Bad Request" };
    const fn = vi.fn().mockRejectedValue(error400);

    await expect(withRetry(fn)).rejects.toEqual(error400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("retries on network fetch errors", async () => {
    vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const networkErr = new Error("fetch failed: ECONNREFUSED");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce("connected");

    const result = await withRetry(fn);
    expect(result).toBe("connected");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_ATTEMPTS (4 attempts) and throws last error", async () => {
    vi.spyOn(limiter, "sleep").mockResolvedValue(undefined);

    const error503 = { status: 503, message: "Service Unavailable" };
    const fn = vi.fn().mockRejectedValue(error503);

    await expect(withRetry(fn)).rejects.toEqual(error503);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(limiter.sleep).toHaveBeenCalledTimes(3);
  });

  it("aborts waiting when AbortSignal is triggered", async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(withRetry(fn, controller.signal)).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
