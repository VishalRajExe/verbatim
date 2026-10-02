/**
 * QA pipeline: question → extract → verify → compose → stream.
 *
 * Architecture §8: extract quotes from chunks, verify each against the
 * document's canonical text, dedupe by canonical range, label Q1…Qn,
 * compose a streamed answer using ONLY verified quotes.
 *
 * I-3: Unverified quotes are NEVER passed to the compose step.
 * I-5: Coverage is tracked; if incomplete, the not-found message is cautious.
 * I-8: API key never logged or returned.
 * I-9: Document text never logged.
 */
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getLlmClient, getLlmModel } from "@/lib/llm/client";
import { withRetry, assertNonEmptyContent } from "@/lib/llm/retry";
import { llmLimiter, sleep } from "@/lib/llm/limiter";
import { parseJson, makeRepairFn, stripCodeFences } from "@/lib/llm/json";
import {
  extractSystemPrompt,
  extractUserMessage,
  composeSystemPrompt,
  composeUserMessage,
  composeMultiSystemPrompt,
  composeMultiUserMessage,
  notFoundComplete,
  notFoundPartial,
  notFoundMulti,
  composeEvidenceFallback,
} from "@/lib/qa/prompts";
import { ExtractResponseSchema } from "@/lib/qa/schemas";
import { chunkDocument } from "@/lib/qa/chunker";
import { selectRelevantChunks } from "@/lib/qa/retrieval";
import {
  initCoverage,
  markChunkRead,
  markChunkFailed,
  type CoverageDoc,
} from "@/lib/qa/coverage";
import { createCitationFilter } from "@/lib/qa/cite-filter";
import {
  encodeEvent,
  type QuoteEventItem,
} from "@/lib/qa/ndjson-events";
import { verifyQuote } from "@/lib/verify/verify-quote";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineDocument {
  id: string;
  name: string;
}

export interface PipelineContext {
  conversationId: string;
  documents?: PipelineDocument[];
  documentId?: string;
  documentName?: string;
  question: string;
  /** AbortSignal from the incoming HTTP request. */
  signal: AbortSignal;
  /** NDJSON writer — called with each raw NDJSON line. */
  emit: (line: string) => void;
}

interface VerifiedQuote {
  ref: string; // "Q1", "Q2", …
  documentId: string;
  documentName: string;
  text: string;
  verified: true;
  matchKind: string;
  pageStart: number | null;
  pageEnd: number | null;
  occurrenceCount: number;
  /** Canonical range from verifyQuote for dedup. */
  canonicalStart: number;
  canonicalEnd: number;
  ranges: unknown;
}

interface UnverifiedQuote {
  ref: string;
  documentId: string;
  documentName: string;
  text: string;
  verified: false;
  matchKind: null;
  failReason: string;
}

type QuoteResult = VerifiedQuote | UnverifiedQuote;

// ---------------------------------------------------------------------------
// Extract step
// ---------------------------------------------------------------------------

async function extractFromChunk(
  documentName: string,
  chunkText: string,
  question: string,
  chunkStart: number,
  chunkEnd: number,
  documentId: string,
  signal: AbortSignal
): Promise<Array<{ text: string; why: string }>> {
  const client = getLlmClient();
  const model = getLlmModel();

  const rawOutput = await withRetry(async () => {
    const resp = await llmLimiter(() =>
      client.chat.completions.create(
        {
          model,
          temperature: 0.1,
          messages: [
            { role: "system", content: extractSystemPrompt() },
            {
              role: "user",
              content: extractUserMessage(documentName, chunkText, question),
            },
          ],
        },
        { signal }
      )
    );
    const content = resp.choices[0]?.message?.content;
    assertNonEmptyContent(content, "extractFromChunk");
    return content;
  }, signal, {
    stage: "extraction",
    model,
    maxAttempts: 3,
  });

  // Tolerant parsing following reference implementation pattern:
  // payload.get("quotes", []) if isinstance(payload, dict) else []
  let quotes: Array<{ text: string; why: string }> = [];
  try {
    const stripped = stripCodeFences(rawOutput);
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed)) {
        quotes = parsed
          .filter((item: any) => item && typeof item.text === "string" && item.text.trim().length > 0)
          .map((item: any) => ({ text: item.text.trim(), why: typeof item.why === "string" ? item.why : "" }));
      } else if (Array.isArray((parsed as any).quotes)) {
        quotes = (parsed as any).quotes
          .filter((item: any) => item && typeof item.text === "string" && item.text.trim().length > 0)
          .map((item: any) => ({ text: item.text.trim(), why: typeof item.why === "string" ? item.why : "" }));
      } else {
        // Model returned an object without quotes key (e.g. { error: "not found" }, { note: "..." })
        quotes = [];
      }
    }
  } catch {
    // If strict JSON.parse failed, fall back to tolerant schema + repair
    const repair = makeRepairFn(client, model, signal);
    const result = await parseJson(rawOutput, ExtractResponseSchema, repair);
    if (result.ok && result.data?.quotes) {
      quotes = result.data.quotes.map((q) => ({ text: q.text, why: q.why || "" }));
    } else {
      quotes = [];
    }
  }

  // Test hook: if VERBATIM_TEST_INVENT_QUOTE is "true", append a fake quote.
  // This is ONLY for testing that unverified quotes are correctly isolated.
  // NEVER enabled in production (env default is "").
  if ((process.env.VERBATIM_TEST_INVENT_QUOTE || env.VERBATIM_TEST_INVENT_QUOTE) === "true") {
    quotes = [
      ...quotes,
      {
        text: "INVENTED QUOTE FOR TESTING: This text does not exist in the document and will fail verification.",
        why: "Test hook: this quote should appear under Couldn't be verified only.",
      },
    ];
  }

  void chunkStart; // used by caller for primary occurrence selection
  void chunkEnd;
  void documentId;

  return quotes;
}

// ---------------------------------------------------------------------------
// Dedup helper
// ---------------------------------------------------------------------------

/** Remove duplicate verified quotes by canonical range (prefer first found). */
function dedupeVerified(quotes: VerifiedQuote[]): VerifiedQuote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const key = `${q.documentId}:${q.canonicalStart}-${q.canonicalEnd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Remove duplicate unverified quotes by trimmed text. */
function dedupeUnverified(quotes: UnverifiedQuote[]): UnverifiedQuote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const key = `${q.documentId}:${q.text.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full QA pipeline for a single- or multi-document conversation.
 * Writes NDJSON events via ctx.emit(); saves Message + Quote rows.
 *
 * @returns messageId of the saved message.
 */
export async function runQaPipeline(ctx: PipelineContext): Promise<string> {
  const { conversationId, question, signal, emit } = ctx;
  const client = getLlmClient();
  const model = getLlmModel();

  // ------------------------------------------------------------------
  // 1. Resolve target documents (single or multi)
  // ------------------------------------------------------------------
  const targetDocs: PipelineDocument[] =
    ctx.documents && ctx.documents.length > 0
      ? ctx.documents
      : [{ id: ctx.documentId!, name: ctx.documentName! }];

  const allCoverages: CoverageDoc[] = [];
  const allRawQuotes: Array<{
    text: string;
    chunkStart: number;
    chunkEnd: number;
    documentId: string;
    documentName: string;
  }> = [];

  // ------------------------------------------------------------------
  // 2. Per-document extraction (TASK 3)
  // ------------------------------------------------------------------
  for (const targetDoc of targetDocs) {
    if (signal.aborted) break;

    const [docText, docRecord, pages] = await Promise.all([
      db.documentText.findUnique({
        where: { documentId: targetDoc.id },
        select: { text: true },
      }),
      db.document.findUnique({
        where: { id: targetDoc.id },
        select: { pageCount: true, warnings: true },
      }),
      db.documentPage.findMany({
        where: { documentId: targetDoc.id },
        select: { pageNo: true, charStart: true, charEnd: true },
        orderBy: { pageNo: "asc" },
      }),
    ]);

    if (!docText) {
      console.error(`Document text not found for doc ${targetDoc.id}`);
      continue;
    }

    const unreadablePages = (() => {
      if (!docRecord?.warnings) return 0;
      const w = docRecord.warnings as { emptyPages?: number[] };
      return Array.isArray(w.emptyPages) ? w.emptyPages.length : 0;
    })();

    const chunks = chunkDocument(docText.text);
    let coverage = initCoverage(
      targetDoc.id,
      targetDoc.name,
      chunks.length,
      docRecord?.pageCount ?? pages.length,
      unreadablePages
    );

    const successfulChunks = new Set<number>();
    const failedChunks = new Set<number>();
    let progressCount = 0;
    // Generic multi-pass concept retrieval & section selection
    const retrieval = selectRelevantChunks(chunks, question, {
      maxChunksToRead: 3,
    });
    const chunksToRead = retrieval.selectedChunks;

    // Emit initial progress for this document
    emit(
      encodeEvent({
        type: "status",
        stage: "reading",
        documentId: targetDoc.id,
        done: 0,
        total: chunksToRead.length,
      })
    );

    for (const chunk of chunksToRead) {
      if (signal.aborted) break;

      try {
        const failHook =
          process.env.VERBATIM_TEST_FAIL_CHUNK ||
          env.VERBATIM_TEST_FAIL_CHUNK;
        if (
          failHook &&
          (failHook === "true"
            ? chunk.index === 0
            : Number(failHook) === chunk.index)
        ) {
          throw new Error(`Test hook: forced failure of chunk ${chunk.index}`);
        }

        const extracted = await extractFromChunk(
          targetDoc.name,
          chunk.text,
          question,
          chunk.charStart,
          chunk.charEnd,
          targetDoc.id,
          signal
        );

        for (const q of extracted) {
          allRawQuotes.push({
            text: q.text,
            chunkStart: chunk.charStart,
            chunkEnd: chunk.charEnd,
            documentId: targetDoc.id,
            documentName: targetDoc.name,
          });
        }
        successfulChunks.add(chunk.index);
      } catch (err: unknown) {
        if (signal.aborted) break;
        console.error(`[qa] chunk ${chunk.index} extraction failed:`, {
          documentId: targetDoc.id,
          chunk: chunk.index,
          error: err instanceof Error ? err.message : String(err),
        });
        failedChunks.add(chunk.index);
      } finally {
        progressCount++;
        emit(
          encodeEvent({
            type: "status",
            stage: "reading",
            documentId: targetDoc.id,
            done: Math.min(progressCount, chunksToRead.length),
            total: chunksToRead.length,
          })
        );
      }

      // Small pacing pause between chunk extractions to stay safely under API rate limits
      if (chunksToRead.length > 1) {
        await sleep(500, signal).catch(() => {});
      }
    }

    coverage = {
      ...coverage,
      chunksRead: successfulChunks.size,
      failedChunks: Array.from(failedChunks).sort((a, b) => a - b),
      complete:
        successfulChunks.size === chunks.length &&
        failedChunks.size === 0 &&
        coverage.unreadablePages === 0,
    };

    allCoverages.push(coverage);
  }

  // ------------------------------------------------------------------
  // 3. Verify evidence (TASK 4 - Rule I-7)
  // ------------------------------------------------------------------
  emit(encodeEvent({ type: "status", stage: "verifying" }));

  const quoteResults: QuoteResult[] = [];
  let verifiedIndex = 0;
  let unverifiedIndex = 0;

  for (const raw of allRawQuotes) {
    if (signal.aborted) break;

    // Rule I-7: verifyQuote using ONLY its attributed documentId
    const result = await verifyQuote(
      raw.text,
      raw.documentId,
      raw.chunkStart,
      raw.chunkEnd
    );

    if (result.verified) {
      quoteResults.push({
        ref: `__tmp_v_${verifiedIndex++}`,
        documentId: raw.documentId,
        documentName: raw.documentName,
        text: raw.text,
        verified: true,
        matchKind: result.matchKind!,
        pageStart: result.pageStart ?? null,
        pageEnd: result.pageEnd ?? null,
        occurrenceCount: result.occurrenceCount,
        canonicalStart: result.canonicalStart!,
        canonicalEnd: result.canonicalEnd!,
        ranges: result.segments,
      });
    } else {
      quoteResults.push({
        ref: `__tmp_u_${unverifiedIndex++}`,
        documentId: raw.documentId,
        documentName: raw.documentName,
        text: raw.text,
        verified: false,
        matchKind: null,
        failReason: result.failReason ?? "NOT_FOUND",
      });
    }
  }

  // Dedup verified quotes by canonical range within the document.
  const verifiedRaw = quoteResults.filter(
    (q): q is VerifiedQuote => q.verified
  );
  const deduped = dedupeVerified(verifiedRaw);

  // Assign final sequential Q1…Qn refs across the answer.
  const verified: VerifiedQuote[] = deduped.map((q, i) => ({
    ...q,
    ref: `Q${i + 1}`,
  }));
  const unverifiedRaw = quoteResults.filter(
    (q): q is UnverifiedQuote => !q.verified
  );
  const unverified = dedupeUnverified(unverifiedRaw);

  // ------------------------------------------------------------------
  // 4. Persist Message and Quote rows
  // ------------------------------------------------------------------
  const message = await db.message.create({
    data: {
      conversationId,
      role: "assistant",
      content: "",
      status: "STREAMING",
      coverage: allCoverages as object,
    },
  });
  const messageId = message.id;

  const allForDb = [
    ...verified,
    ...unverified.map((u, i) => ({ ...u, ref: `U${i + 1}` })),
  ];
  if (allForDb.length > 0) {
    await db.quote.createMany({
      data: allForDb.map((q) => ({
        messageId,
        documentId: q.documentId,
        ref: q.ref,
        text: q.text,
        verified: q.verified,
        matchKind: q.verified ? (q as VerifiedQuote).matchKind : null,
        failReason: q.verified ? null : (q as UnverifiedQuote).failReason,
        ranges: q.verified ? ((q as VerifiedQuote).ranges as object) : undefined,
      })),
    });
  }

  // ------------------------------------------------------------------
  // 5. Emit quotes and coverage events
  // ------------------------------------------------------------------
  const quoteEventItems: QuoteEventItem[] = [
    ...verified.map(
      (q): QuoteEventItem => ({
        ref: q.ref,
        documentId: q.documentId,
        documentName: q.documentName,
        verified: true,
        matchKind: q.matchKind,
        failReason: null,
        text: q.text,
        pageStart: q.pageStart,
        pageEnd: q.pageEnd,
        occurrences: q.occurrenceCount,
        ranges: q.ranges as any,
      })
    ),
    ...unverified.map(
      (q, i): QuoteEventItem => ({
        ref: `U${i + 1}`,
        documentId: q.documentId,
        documentName: q.documentName,
        verified: false,
        matchKind: null,
        failReason: q.failReason,
        text: q.text,
        pageStart: null,
        pageEnd: null,
        occurrences: 0,
      })
    ),
  ];

  emit(encodeEvent({ type: "quotes", quotes: quoteEventItems }));
  emit(encodeEvent({ type: "coverage", coverage: allCoverages }));

  // ------------------------------------------------------------------
  // 6. Compose (or deterministic not-found) (TASK 5)
  // ------------------------------------------------------------------
  let finalContent = "";
  let finalStatus: "complete" | "stopped" | "error" = "complete";

  if (verified.length === 0) {
    // Deterministic not-found — no model call (Architecture §8, I-3, I-5)
    if (targetDocs.length === 1) {
      const cov = allCoverages[0];
      finalContent = cov?.complete
        ? notFoundComplete(targetDocs[0].name, cov.chunksTotal)
        : notFoundPartial(
            targetDocs[0].name,
            cov?.chunksRead ?? 0,
            cov?.chunksTotal ?? 0,
            cov?.unreadablePages
          );
    } else {
      finalContent = notFoundMulti(allCoverages);
    }
    emit(encodeEvent({ type: "token", text: finalContent }));
  } else {
    // Compose using ONLY verified quotes (I-3).
    emit(encodeEvent({ type: "status", stage: "composing" }));

    const verifiedRefs = new Set(verified.map((q) => q.ref));
    const filter = createCitationFilter(verifiedRefs);

    const isMulti = targetDocs.length > 1;
    const systemPrompt = isMulti
      ? composeMultiSystemPrompt()
      : composeSystemPrompt();
    const userMessage = isMulti
      ? composeMultiUserMessage(
          verified.map((q) => ({
            ref: q.ref,
            documentName: q.documentName,
            text: q.text,
          })),
          targetDocs.map((d) => d.name),
          question
        )
      : composeUserMessage(
          verified.map((q) => ({ ref: q.ref, text: q.text })),
          targetDocs[0].name,
          question
        );

    let compositionSuccess = false;

    try {
      const stream = await withRetry(
        () =>
          llmLimiter(() =>
            client.chat.completions.create(
              {
                model,
                temperature: 0.2,
                stream: true,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userMessage },
                ],
              },
              { signal }
            )
          ),
        signal,
        {
          stage: "composition",
          model,
          maxAttempts: 3,
          onRetry: (_attempt, _delayMs, err) => {
            const status =
              err && typeof err === "object" && "status" in err
                ? (err as { status: unknown }).status
                : null;
            const isRateLimit = status === 429;
            emit(
              encodeEvent({
                type: "status",
                stage: "composing",
                message: isRateLimit
                  ? "The AI service is temporarily rate-limited. Retrying…"
                  : "Connecting to AI service. Retrying…",
              })
            );
          },
        }
      );

      for await (const part of stream) {
        if (signal.aborted) {
          finalStatus = "stopped";
          break;
        }
        const token = part.choices[0]?.delta?.content;
        if (!token) continue;
        const filtered = filter.push(token);
        if (filtered) {
          finalContent += filtered;
          emit(encodeEvent({ type: "token", text: filtered }));
        }
      }

      // Flush any remaining buffer (partial marker → discarded).
      const tail = filter.flush();
      if (tail) {
        finalContent += tail;
        emit(encodeEvent({ type: "token", text: tail }));
      }

      if (!signal.aborted) {
        finalStatus = "complete";
        compositionSuccess = true;
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        finalStatus = "stopped";
      } else {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status: unknown }).status
            : null;
        console.warn(
          `[qa] composition failed (status: ${status}):`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Safe fallback: If composition failed (e.g. rate limit 429 after retries) but we have verified quotes,
    // generate a deterministic evidence-based answer directly from the verified quotes (Rules I-3, I-5).
    if (!compositionSuccess && !signal.aborted) {
      const allCoverageComplete = allCoverages.every((c) => c.complete);
      const uninspectedReason = allCoverages.some((c) => c.failedChunks.length > 0)
        ? "some document sections could not be inspected due to service limits"
        : undefined;

      const fallbackText = composeEvidenceFallback(
        verified.map((q) => ({
          ref: q.ref,
          documentName: q.documentName,
          text: q.text,
          pageStart: q.pageStart,
        })),
        targetDocs.map((d) => d.name),
        allCoverageComplete,
        uninspectedReason
      );

      if (finalContent.trim().length === 0) {
        finalContent = fallbackText;
        emit(encodeEvent({ type: "token", text: fallbackText }));
      } else {
        // In the rare event of a mid-stream failure, append notice
        const notice = "\n\n*(AI composition stream was interrupted. Verified evidence shown above.)*";
        finalContent += notice;
        emit(encodeEvent({ type: "token", text: notice }));
      }

      finalStatus = "complete";
    }
  }

  // ------------------------------------------------------------------
  // 7. Persist final message state
  // ------------------------------------------------------------------
  await db.message.update({
    where: { id: messageId },
    data: {
      content: finalContent,
      status:
        finalStatus === "complete"
          ? "COMPLETE"
          : finalStatus === "stopped"
          ? "STOPPED"
          : "ERROR",
      coverage: allCoverages as object,
    },
  });

  emit(encodeEvent({ type: "done", messageId, status: finalStatus }));
  return messageId;
}

// ---------------------------------------------------------------------------
// Coverage helpers (re-exported for the route)
// ---------------------------------------------------------------------------
export type { CoverageDoc };
