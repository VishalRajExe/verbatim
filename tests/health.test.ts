import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("should return database available and llm configured without leaking secrets", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("available");
    expect(body.llm).toBe("configured");
    expect(body.timestamp).toBeDefined();

    // Verify Invariant I-8 & Phase 0 acceptance: never return API keys or secrets
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("key");
    expect(bodyStr).not.toContain("AQ.");
    expect(bodyStr).not.toContain("password");
    expect(bodyStr).not.toContain("admin");
  });
});
