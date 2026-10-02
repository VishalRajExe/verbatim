import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import { env, isLlmConfigured } from "@/lib/env";

describe("Spike C: Gemini OpenAI-compatible client", () => {
  it("should stream completion and produce structured JSON output", async () => {
    if (!isLlmConfigured()) {
      console.warn("Skipping Spike C live test: LLM_API_KEY not configured");
      return;
    }

    const client = new OpenAI({
      apiKey: env.LLM_API_KEY,
      baseURL: env.LLM_BASE_URL,
    });

    // 1. Streamed completion
    const stream = await client.chat.completions.create({
      model: env.LLM_MODEL,
      messages: [{ role: "user", content: "Respond with the word 'VERIFIED'." }],
      stream: true,
      max_tokens: 300,
    });

    let streamedText = "";
    for await (const chunk of stream) {
      streamedText += chunk.choices[0]?.delta?.content || "";
    }
    expect(streamedText.length).toBeGreaterThan(0);
    expect(streamedText.toUpperCase()).toContain("VERIFIED");

    // 2. Structured JSON completion
    const jsonCompletion = await client.chat.completions.create({
      model: env.LLM_MODEL,
      messages: [
        {
          role: "user",
          content: "Return JSON for { status: 'OK', code: 200 }",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "HealthCheckSchema",
          strict: true,
          schema: {
            type: "object",
            properties: {
              status: { type: "string" },
              code: { type: "integer" },
            },
            required: ["status", "code"],
            additionalProperties: false,
          },
        },
      },
      temperature: 0,
    });

    const rawContent = jsonCompletion.choices[0]?.message?.content || "";
    expect(rawContent.length).toBeGreaterThan(0);

    const parsed = JSON.parse(rawContent);
    expect(parsed.status).toBe("OK");
    expect(parsed.code).toBe(200);
  });
});
