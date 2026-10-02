/**
 * Comparison Pipeline (FR-7).
 *
 * Orchestrates:
 * 1. Clause splitting (clauses.ts)
 * 2. Clause alignment (align.ts)
 * 3. Categorization (categories.ts)
 * 4. Materiality floor evaluation (materiality.ts)
 * 5. Batched AI summarization with deterministic fallback
 * 6. Overall summary generation
 */

import { splitClauses } from "./clauses";
import { alignClauses, ChangeType, Significance } from "./align";
import { categorizeClause } from "./categories";
import { calculateMaterialityFloor, enforceSignificanceFloor, extractMaterialTokens } from "./materiality";
import { getLlmClient, getLlmModel } from "@/lib/llm/client";
import { parseJson } from "@/lib/llm/json";
import { withRetry, assertNonEmptyContent } from "@/lib/llm/retry";
import { z } from "zod";
import type OpenAI from "openai";

/** Minimal interface covering real OpenAI client + test mocks. */
interface LlmClient {
  chat?: OpenAI["chat"];
  generateJson?: (opts: { system: string; prompt: string }) => Promise<unknown>;
}

export interface ComparisonPipelineChange {
  id: string;
  orderIdx: number;
  type: ChangeType;
  significance: Significance;
  category: string;
  title: string;
  summary: string;
  summarySource: "ai" | "automatic";
  aText: string | null;
  bText: string | null;
  aStart: number | null;
  aEnd: number | null;
  bStart: number | null;
  bEnd: number | null;
}

export interface ComparisonPipelineStats {
  totalChanges: number;
  high: number;
  medium: number;
  low: number;
  cosmetic: number;
  unchanged: number;
  added: number;
  removed: number;
  modified: number;
  moved: number;
}

export interface ComparisonPipelineResult {
  summary: string;
  stats: ComparisonPipelineStats;
  confidence: number;
  hasUncertainty: boolean;
  uncertaintyReason?: string;
  changes: ComparisonPipelineChange[];
}

const AI_BATCH_SIZE = 15;

const AiChangeItemSchema = z.object({
  id: z.string(),
  title: z.string().optional().default("Clause Update"),
  summary: z.string().optional().default("Clause modified"),
  significance: z.enum(["HIGH", "MEDIUM", "LOW", "COSMETIC"]).optional().default("LOW"),
});

const AiChangeBatchSchema = z.array(AiChangeItemSchema);

/**
 * Builds a deterministic fallback summary from token differences when AI is unavailable.
 */
function buildDeterministicSummary(
  type: ChangeType,
  category: string,
  oldText: string | null,
  newText: string | null
): string {
  const catName = category.replace(/_/g, " ");

  if (type === "ADDED") {
    return `New clause added covering ${catName}.`;
  }
  if (type === "REMOVED") {
    return `Clause removed regarding ${catName}.`;
  }
  if (type === "MOVED") {
    return `Clause moved to a different position in the contract without text modifications.`;
  }

  const tokOld = extractMaterialTokens(oldText);
  const tokNew = extractMaterialTokens(newText);

  // Amount change
  if (tokOld.amounts.length > 0 && tokNew.amounts.length > 0) {
    const a1 = tokOld.amounts[0];
    const a2 = tokNew.amounts[0];
    if (a1.value !== a2.value) {
      return `Amount changed from ${a1.raw} to ${a2.raw}.`;
    }
  }

  // Time / unit change
  if (tokOld.numbersWithUnits.length > 0 && tokNew.numbersWithUnits.length > 0) {
    const u1 = tokOld.numbersWithUnits[0];
    const u2 = tokNew.numbersWithUnits[0];
    if (u1 !== u2) {
      return `Time period or duration changed from ${u1} to ${u2}.`;
    }
  }

  // Percentage change
  if (tokOld.percentages.length > 0 && tokNew.percentages.length > 0) {
    const p1 = tokOld.percentages[0];
    const p2 = tokNew.percentages[0];
    if (p1 !== p2) {
      return `Rate changed from ${p1} to ${p2}.`;
    }
  }

  // Date change
  if (tokOld.dates.length > 0 && tokNew.dates.length > 0) {
    const d1 = tokOld.dates[0];
    const d2 = tokNew.dates[0];
    if (d1 !== d2) {
      return `Date changed from ${d1} to ${d2}.`;
    }
  }

  // Jurisdiction
  if (tokOld.jurisdictions.length > 0 && tokNew.jurisdictions.length > 0) {
    const j1 = tokOld.jurisdictions[0];
    const j2 = tokNew.jurisdictions[0];
    if (j1 !== j2) {
      return `Jurisdiction changed from ${j1} to ${j2}.`;
    }
  }

  // Modal / obligation words
  if (tokOld.modals.join(",") !== tokNew.modals.join(",")) {
    return `Obligation terminology updated in ${catName} clause.`;
  }

  return `Wording updated in ${catName} clause with no substantive change in obligations.`;
}

export interface PipelineOptions {
  llm?: LlmClient; // optional custom LLM mock/instance
  signal?: AbortSignal;
  onProgress?: (stage: string) => Promise<void> | void;
}

/**
 * Runs the complete contract comparison pipeline.
 */
export async function runComparisonPipeline(
  textA: string,
  textB: string,
  options: PipelineOptions = {}
): Promise<ComparisonPipelineResult> {
  // 1. Split clauses
  await options.onProgress?.("Splitting clauses");
  const splitA = splitClauses(textA);
  const splitB = splitClauses(textB);

  const confidence = Math.min(splitA.confidence, splitB.confidence);
  const hasUncertainty = splitA.hasUncertainty || splitB.hasUncertainty;
  const uncertaintyReason = splitA.reason || splitB.reason;

  // 2. Align clauses
  await options.onProgress?.("Aligning clauses");
  const alignment = alignClauses(splitA.clauses, splitB.clauses);

  // 3. Materiality & Categorization
  await options.onProgress?.("Evaluating materiality and categories");
  interface PreparedChange {
    id: string;
    orderIdx: number;
    type: ChangeType;
    category: string;
    floor: Significance;
    defaultTitle: string;
    aText: string | null;
    bText: string | null;
    aStart: number | null;
    aEnd: number | null;
    bStart: number | null;
    bEnd: number | null;
  }

  const prepared: PreparedChange[] = alignment.changes.map((ch, idx) => {
    const aText = ch.aClause?.text || null;
    const bText = ch.bClause?.text || null;
    const head = ch.bClause?.heading || ch.aClause?.heading || null;

    const category = categorizeClause(bText || aText || "", head);
    let floor: Significance = "LOW";

    if (ch.significance === "COSMETIC") {
      floor = "COSMETIC";
    } else {
      const mat = calculateMaterialityFloor(ch.type, aText, bText, category);
      floor = mat.floor;
    }

    const headingTitle = head ? head.trim() : (category ? category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : `Clause ${idx + 1}`);

    return {
      id: ch.id || `change-${idx + 1}`,
      orderIdx: idx,
      type: ch.type,
      category,
      floor,
      defaultTitle: headingTitle,
      aText,
      bText,
      aStart: ch.aClause ? ch.aClause.start : null,
      aEnd: ch.aClause ? ch.aClause.end : null,
      bStart: ch.bClause ? ch.bClause.start : null,
      bEnd: ch.bClause ? ch.bClause.end : null,
    };
  });

  // 4. Batched AI summarization (with fallback)
  const finalChanges: ComparisonPipelineChange[] = [];

  // Group into batches of ~15
  const batches: PreparedChange[][] = [];
  for (let i = 0; i < prepared.length; i += AI_BATCH_SIZE) {
    batches.push(prepared.slice(i, i + AI_BATCH_SIZE));
  }

  let client: LlmClient | null = null;
  let modelName = "";

  if (options.llm) {
    client = options.llm;
    modelName = "custom-llm";
  } else {
    try {
      client = getLlmClient();
      modelName = getLlmModel();
    } catch {
      // Env variables might not be set or configured
      client = null;
    }
  }

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    await options.onProgress?.(`Summarizing changes (batch ${bIdx + 1} of ${Math.max(1, batches.length)})`);

    let aiResults: Map<string, { title: string; summary: string; significance: Significance }> | null = null;

    if (client) {
      try {
        const batchPayload = batch.map((item) => ({
          id: item.id,
          type: item.type,
          category: item.category,
          floor: item.floor,
          oldText: item.aText ? (item.aText.length > 500 ? item.aText.slice(0, 500) + "..." : item.aText) : null,
          newText: item.bText ? (item.bText.length > 500 ? item.bText.slice(0, 500) + "..." : item.bText) : null,
        }));

        const systemPrompt = `You are an expert contract comparison analyst.
Analyze each clause difference between Document A and Document B.
For each item in the input array, return an object with:
- "id": string (the exact matching item id)
- "title": concise 3 to 7 word title of the clause change
- "summary": substantive, plain-language legal explanation of what changed in the rights, obligations, liability, or amounts. Example: "Liability cap raised from AED 100,000 to AED 1,000,000". Do NOT say "wording changed" if there is a substantive shift.
- "significance": "HIGH", "MEDIUM", "LOW", or "COSMETIC".
  CRITICAL RULE: You may raise the significance above the item's floor, but you may NEVER lower it below the floor.

Return ONLY a valid JSON array of objects.`;

        const userPrompt = `Review these changes and output the JSON array:\n${JSON.stringify(batchPayload, null, 2)}`;

        let rawResponse = "";
        if (typeof client.generateJson === "function") {
          // Mock or custom method
          const res = await client.generateJson({ system: systemPrompt, prompt: userPrompt });
          rawResponse = typeof res === "string" ? res : JSON.stringify(res);
        } else {
          // Standard OpenAI SDK client with retry
          if (!client.chat) {
            throw new Error("[ComparePipeline] LLM client has no chat interface");
          }
          const chat = client.chat;
          const resp = await withRetry(async () => {
            return chat.completions.create(
              {
                model: modelName,
                temperature: 0,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
              },
              { signal: options.signal }
            );
          }, options.signal);

          rawResponse = resp.choices[0]?.message?.content ?? "";
          assertNonEmptyContent(rawResponse || null, "comparePipeline.aiBatch");
        }

        const parsed = await parseJson(rawResponse, AiChangeBatchSchema);
        if (parsed.ok && parsed.data) {
          aiResults = new Map();
          for (const item of parsed.data) {
            aiResults.set(item.id, {
              title: item.title || "Clause Update",
              summary: item.summary || "Clause modified",
              significance: (item.significance as Significance) || "LOW",
            });
          }
        }
      } catch (err) {
        console.warn(`[ComparePipeline] AI batch ${bIdx + 1} failed, using automatic fallback:`, err);
        aiResults = null;
      }
    }

    // Process each item in the batch
    for (const item of batch) {
      const aiItem = aiResults?.get(item.id);

      if (aiItem && aiItem.summary) {
        const finalSig = enforceSignificanceFloor(aiItem.significance, item.floor);
        finalChanges.push({
          id: item.id,
          orderIdx: item.orderIdx,
          type: item.type,
          significance: finalSig,
          category: item.category,
          title: aiItem.title || item.defaultTitle,
          summary: aiItem.summary,
          summarySource: "ai",
          aText: item.aText,
          bText: item.bText,
          aStart: item.aStart,
          aEnd: item.aEnd,
          bStart: item.bStart,
          bEnd: item.bEnd,
        });
      } else {
        // Automatic fallback summary
        const autoSummary = buildDeterministicSummary(item.type, item.category, item.aText, item.bText);
        finalChanges.push({
          id: item.id,
          orderIdx: item.orderIdx,
          type: item.type,
          significance: item.floor,
          category: item.category,
          title: item.defaultTitle,
          summary: autoSummary,
          summarySource: "automatic",
          aText: item.aText,
          bText: item.bText,
          aStart: item.aStart,
          aEnd: item.aEnd,
          bStart: item.bStart,
          bEnd: item.bEnd,
        });
      }
    }
  }

  // 5. Compute stats
  const stats: ComparisonPipelineStats = {
    totalChanges: finalChanges.length,
    high: finalChanges.filter((c) => c.significance === "HIGH").length,
    medium: finalChanges.filter((c) => c.significance === "MEDIUM").length,
    low: finalChanges.filter((c) => c.significance === "LOW").length,
    cosmetic: finalChanges.filter((c) => c.significance === "COSMETIC").length,
    unchanged: alignment.unchangedCount,
    added: finalChanges.filter((c) => c.type === "ADDED").length,
    removed: finalChanges.filter((c) => c.type === "REMOVED").length,
    modified: finalChanges.filter((c) => c.type === "MODIFIED").length,
    moved: finalChanges.filter((c) => c.type === "MOVED").length,
  };

  // 6. Overall summary
  await options.onProgress?.("Generating overall summary");
  let overallSummary = "";

  if (finalChanges.length === 0) {
    overallSummary = `No meaningful differences. ${alignment.unchangedCount} clauses are identical.`;
  } else {
    // Generate automatic overview
    const topSignificant = finalChanges.filter((c) => c.significance === "HIGH");
    let highlights = "";
    if (topSignificant.length > 0) {
      highlights = ` Key changes include: ${topSignificant.map((c) => c.summary).slice(0, 2).join(" ")}`;
    }

    overallSummary = `${finalChanges.length} meaningful change${finalChanges.length === 1 ? "" : "s"} detected (${stats.high} high, ${stats.medium} medium, ${stats.low} low). ${alignment.unchangedCount} clauses are identical.${highlights}`;
  }

  return {
    summary: overallSummary,
    stats,
    confidence,
    hasUncertainty,
    uncertaintyReason,
    changes: finalChanges,
  };
}
