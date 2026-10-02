/**
 * Tolerant JSON parser for LLM outputs.
 *
 * LLM responses often wrap JSON in markdown code fences (```json … ```).
 * This module:
 *   1. Strips leading/trailing whitespace.
 *   2. Removes opening ```json / ``` fences.
 *   3. Parses the result with JSON.parse.
 *   4. Validates with a Zod schema.
 *   5. On a parse or validation error, makes one repair attempt by asking
 *      the model to output valid JSON only.
 *
 * A failed extraction is not a crash: callers mark the chunk as failed
 * (lowers coverage) rather than crashing the whole request.
 */
import { z } from "zod";
import type OpenAI from "openai";

/** Strip markdown code fences and trim whitespace. */
export function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/** Best-effort parse: strip fences, then JSON.parse. */
export function tolerantParse(raw: string): unknown {
  return JSON.parse(stripCodeFences(raw));
}

export interface ParseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Parse and Zod-validate LLM JSON output.
 * On failure: one repair attempt using the model, then give up.
 *
 * @param raw - Raw LLM output string.
 * @param schema - Zod schema to validate against.
 * @param repair - Optional async function that takes the broken text and
 *                 returns a corrected JSON string (the repair call).
 */
export async function parseJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  repair?: (broken: string) => Promise<string>
): Promise<ParseResult<T>> {
  // Attempt 1: tolerant parse + zod validate.
  try {
    const parsed = tolerantParse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, data: result.data };
    // Zod failed – try repair.
    throw new Error(`Zod: ${result.error.message}`);
  } catch (firstErr: unknown) {
    if (!repair) {
      return {
        ok: false,
        error: firstErr instanceof Error ? firstErr.message : String(firstErr),
      };
    }
  }

  // Attempt 2: repair call.
  try {
    const repaired = await repair(raw);
    const parsed = tolerantParse(repaired);
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, data: result.data };
    return { ok: false, error: `Repair zod: ${result.error.message}` };
  } catch (repairErr: unknown) {
    return {
      ok: false,
      error: repairErr instanceof Error ? repairErr.message : String(repairErr),
    };
  }
}

/**
 * Build a repair function that asks the LLM to output valid JSON only.
 * Adapted from rag-contract-analyzer refusal pattern.
 */
export function makeRepairFn(
  client: OpenAI,
  model: string,
  signal?: AbortSignal
): (broken: string) => Promise<string> {
  return async (broken: string) => {
    const resp = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a JSON repair assistant. Output only valid JSON. No explanation, no markdown fences.",
          },
          {
            role: "user",
            content: `The following text was supposed to be JSON but failed to parse. Output the corrected JSON only:\n\n${broken}`,
          },
        ],
      },
      { signal }
    );
    return resp.choices[0]?.message?.content ?? "";
  };
}
