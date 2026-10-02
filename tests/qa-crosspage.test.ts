import { describe, it, expect } from "vitest";
import { verifyQuote } from "@/lib/verify/verify-quote";
import { db } from "@/lib/db";

describe("Cross-page incident report quotes verification", () => {
  it("verifies Q1 on page 37 and Q2 on page 38", async () => {
    const doc = await db.document.findFirst({
      where: { name: "verbatim_demo_150_page_contract.pdf", pageCount: 150 },
      orderBy: { createdAt: "asc" }
    });
    expect(doc).toBeDefined();
    if (!doc) return;

    const q1Text = "Supplier shall\nprovide a written incident report containing root cause, affected systems, remediation actions, customer\ncommunications, and evidence of corrective controls,";
    const q2Text = "together with a timeline showing detection, containment, recovery,\nand closure within five business days after the incident is confirmed.";

    const res1 = await verifyQuote(q1Text, doc.id);
    expect(res1.verified).toBe(true);
    expect(res1.pageStart).toBe(37);
    expect(res1.pageEnd).toBe(37);

    const res2 = await verifyQuote(q2Text, doc.id);
    expect(res2.verified).toBe(true);
    expect(res2.pageStart).toBe(38);
    expect(res2.pageEnd).toBe(38);
  });
});
