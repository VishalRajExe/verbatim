import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z
    .string()
    .url()
    .default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  LLM_MODEL: z.string().default("gemini-flash-latest"),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  LLM_REASONING_EFFORT: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
  CHUNK_TOKENS: z.coerce.number().int().positive().default(24000),
  MAX_DOCS_PER_QUESTION: z.coerce.number().int().positive().default(5),
  SOFFICE_PATH: z.string().default("soffice"),
  REDLINE_AUTHOR: z.string().default("Verbatim AI"),
  // Test-only hook: when "true", the extract step appends one invented quote.
  // This allows verifying that unverified quotes are shown but never used in compose.
  // MUST remain off (default "") in all production deployments.
  VERBATIM_TEST_INVENT_QUOTE: z.string().default(""),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  throw new Error(`Environment validation failed:\n${issues}`);
}

export const env = parsed.data;

export function isLlmConfigured(): boolean {
  return typeof env.LLM_API_KEY === "string" && env.LLM_API_KEY.trim().length > 0;
}
