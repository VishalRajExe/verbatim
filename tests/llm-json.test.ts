import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { stripCodeFences, tolerantParse, parseJson } from "@/lib/llm/json";

describe("Phase 3 - tolerant JSON parser", () => {
  it("strips markdown code fences with json language identifier", () => {
    const raw = "```json\n{\"foo\": \"bar\"}\n```";
    expect(stripCodeFences(raw)).toBe('{"foo": "bar"}');
  });

  it("strips generic markdown code fences without language identifier", () => {
    const raw = "```\n{\"foo\": \"bar\"}\n```";
    expect(stripCodeFences(raw)).toBe('{"foo": "bar"}');
  });

  it("strips fences with leading or trailing whitespace", () => {
    const raw = "  \n  ```json\n{\"count\": 42}\n```  \n  ";
    expect(stripCodeFences(raw)).toBe('{"count": 42}');
  });

  it("tolerantParse handles valid fenced JSON", () => {
    const raw = "```json\n{\"greeting\": \"hello\"}\n```";
    expect(tolerantParse(raw)).toEqual({ greeting: "hello" });
  });

  it("parseJson successfully parses and validates against Zod schema", async () => {
    const schema = z.object({
      quotes: z.array(z.object({ text: z.string(), why: z.string() })),
    });

    const raw = `\`\`\`json
{
  "quotes": [
    { "text": "Confidentiality shall last 3 years.", "why": "Specifies term" }
  ]
}
\`\`\``;

    const result = await parseJson(raw, schema);
    expect(result.ok).toBe(true);
    expect(result.data?.quotes).toHaveLength(1);
    expect(result.data?.quotes[0].text).toBe("Confidentiality shall last 3 years.");
  });

  it("parseJson calls repair function on initial syntax failure and returns recovered data", async () => {
    const schema = z.object({ value: z.number() });
    const broken = "Here is the result: { value: 10, }"; // invalid trailing comma or markdown

    const repairFn = vi.fn().mockResolvedValue('{"value": 10}');

    const result = await parseJson(broken, schema, repairFn);
    expect(repairFn).toHaveBeenCalledWith(broken);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ value: 10 });
  });

  it("parseJson returns error if repair also fails", async () => {
    const schema = z.object({ value: z.number() });
    const broken = "not json at all";
    const repairFn = vi.fn().mockResolvedValue("still not json");

    const result = await parseJson(broken, schema, repairFn);
    expect(repairFn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("parseJson returns error if no repair function is provided", async () => {
    const schema = z.object({ value: z.number() });
    const broken = "invalid json";

    const result = await parseJson(broken, schema);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
