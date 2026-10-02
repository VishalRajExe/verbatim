import OpenAI from "openai";
import { env } from "@/lib/env";

let llmClientInstance: OpenAI | null = null;

export function getLlmClient(): OpenAI {
  if (!llmClientInstance) {
    llmClientInstance = new OpenAI({
      apiKey: env.LLM_API_KEY,
      baseURL: env.LLM_BASE_URL,
    });
  }
  return llmClientInstance;
}
