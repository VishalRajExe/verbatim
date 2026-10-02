/**
 * Zod schemas for LLM JSON outputs in the QA pipeline.
 */
import { z } from "zod";

/** Schema for the extract step response. */
export const ExtractResponseSchema = z.object({
  quotes: z.array(
    z.object({
      text: z.string().min(1),
      why: z.string().min(1),
    })
  ),
});

export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;
export type ExtractedQuote = ExtractResponse["quotes"][number];
