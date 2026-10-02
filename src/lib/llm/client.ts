/**
 * Lazy OpenAI client singleton pointed at the configured LLM provider.
 *
 * API key is read server-side only (env.LLM_API_KEY).
 * Never logged or returned to the client (I-8).
 */
import OpenAI from "openai";
import { env } from "@/lib/env";

let _client: OpenAI | null = null;

export function getLlmClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: env.LLM_API_KEY,
      baseURL: env.LLM_BASE_URL,
    });
  }
  return _client;
}

/** Return the configured model name from env. */
export function getLlmModel(): string {
  return env.LLM_MODEL;
}
