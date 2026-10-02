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
import { withRetry } from "@/lib/llm/retry";
import { llmLimiter } from "@/lib/llm/limiter";
import { parseJson, makeRepairFn } from "@/lib/llm/json";
import {
  extractSystemPrompt,
  extractUserMessage,
  composeSystemPrompt,
  composeUserMessage,
  notFoundComplete,
  notFoundPartial,
} from "@/lib/qa/prompts";
import { ExtractResponseSchema } from "@/lib/qa/schemas";
import { chunkDocument } from "@/lib/qa/chunker";
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

export interface PipelineContext {
  conversationId: string;
  documentId: string;
  documentName: string;
  question: string;
  /** AbortSignal from the incoming HTTP request. */
  signal: AbortSignal;
  /** NDJSON writer — called with each raw NDJSON line. */
  emit: (line: string) => void;
}

interface VerifiedQuote {
  ref: string; // "Q1", "Q2", …
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
    return resp.choices[0]?.message?.content ?? "";
  }, signal);

  const repair = makeRepairFn(client, model, signal);
  const result = await parseJson(rawOutput, ExtractResponseSchema, repair);

  if (!result.ok || !result.data) {
    // Failed extraction lowers coverage but doesn't crash.
    throw new Error(`Extract parse failed: ${result.error}`);
  }

  let quotes = result.data.quotes;

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
    const key = `${q.canonicalStart}-${q.canonicalEnd}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Remove duplicate unverified quotes by trimmed text. */
function dedupeUnverified(quotes: UnverifiedQuote[]): UnverifiedQuote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const key = q.text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full QA pipeline for a single-document conversation.
 * Writes NDJSON events via ctx.emit(); saves Message + Quote rows.
 *
 * @returns messageId of the saved message.
 */
export async function runQaPipeline(ctx: PipelineContext): Promise<string> {
  const { conversationId, documentId, documentName, question, signal, emit } =
    ctx;
  const client = getLlmClient();
  const model = getLlmModel();

  // ------------------------------------------------------------------
  // 1. Load document text and pages
  // ------------------------------------------------------------------
  const [docText, doc, pages] = await Promise.all([
    db.documentText.findUnique({
      where: { documentId },
      select: { text: true },
    }),
    db.document.findUnique({
      where: { id: documentId },
      select: { pageCount: true, warnings: true },
    }),
    db.documentPage.findMany({
      where: { documentId },
      select: { pageNo: true, charStart: true, charEnd: true },
      orderBy: { pageNo: "asc" },
    }),
  ]);

  if (!docText) throw new Error("Document text not found");

  const unreadablePages = (() => {
    if (!doc?.warnings) return 0;
    const w = doc.warnings as { emptyPages?: number[] };
    return Array.isArray(w.emptyPages) ? w.emptyPages.length : 0;
  })();

  // ------------------------------------------------------------------
  // 2. Chunk the document
  // ------------------------------------------------------------------
  const chunks = chunkDocument(docText.text);
  let coverage = initCoverage(
    documentId,
    documentName,
    chunks.length,
    doc?.pageCount ?? pages.length,
    unreadablePages
  );

  // ------------------------------------------------------------------
  // 3. Extract (map over chunks with LLM_MAX_CONCURRENCY)
  // ------------------------------------------------------------------
  const allRawQuotes: Array<{
    text: string;
    chunkStart: number;
    chunkEnd: number;
  }> = [];

  const successfulChunks = new Set<number>();
  const failedChunks = new Set<number>();
  let progressCount = 0;

  // Emit initial progress
  emit(
    encodeEvent({
      type: "status",
      stage: "reading",
      documentId,
      done: 0,
      total: chunks.length,
    })
  );

  await Promise.all(
    chunks.map(async (chunk) => {
      if (signal.aborted) return;

        emit(
          encodeEvent({
            type: "status",
            stage: "reading",
            documentId,
            done: progressCount + 1,
            total: chunks.length,
          })
        );

        try {
          // Test hook: force failure of a chosen chunk
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
            documentName,
            chunk.text,
            question,
            chunk.charStart,
            chunk.charEnd,
            documentId,
            signal
          );

          for (const q of extracted) {
            allRawQuotes.push({
              text: q.text,
              chunkStart: chunk.charStart,
              chunkEnd: chunk.charEnd,
            });
          }
          successfulChunks.add(chunk.index);
        } catch (err: unknown) {
          if (signal.aborted) return;
          // Log error metadata only — never log document text (I-9).
          console.error(`[qa] chunk ${chunk.index} extraction failed:`, {
            documentId,
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
              documentId,
              done: Math.min(progressCount, chunks.length),
              total: chunks.length,
            })
          );
        }
      })
  );

  coverage = {
    ...coverage,
    chunksRead: successfulChunks.size,
    failedChunks: Array.from(failedChunks).sort((a, b) => a - b),
    complete:
      successfulChunks.size === chunks.length &&
      failedChunks.size === 0 &&
      coverage.unreadablePages === 0,
  };

  // ------------------------------------------------------------------
  // 4. Verify
  // ------------------------------------------------------------------
  emit(encodeEvent({ type: "status", stage: "verifying" }));

  const quoteResults: QuoteResult[] = [];
  let verifiedIndex = 0;
  let unverifiedIndex = 0;

  for (const raw of allRawQuotes) {
    if (signal.aborted) break;

    const result = await verifyQuote(
      raw.text,
      documentId,
      raw.chunkStart,
      raw.chunkEnd
    );

    if (result.verified) {
      // Ref assignment (Q1, Q2, …) happens after dedup below.
      quoteResults.push({
        ref: `__tmp_v_${verifiedIndex++}`,
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
        text: raw.text,
        verified: false,
        matchKind: null,
        failReason: result.failReason ?? "NOT_FOUND",
      });
    }
  }

  // Dedup verified quotes by canonical range.
  const verifiedRaw = quoteResults.filter(
    (q): q is VerifiedQuote => q.verified
  );
  const deduped = dedupeVerified(verifiedRaw);

  // Assign final Q1…Qn refs.
  const verified: VerifiedQuote[] = deduped.map((q, i) => ({
    ...q,
    ref: `Q${i + 1}`,
  }));
  const unverifiedRaw = quoteResults.filter(
    (q): q is UnverifiedQuote => !q.verified
  );
  const unverified = dedupeUnverified(unverifiedRaw);

  // ------------------------------------------------------------------
  // 5. Persist Quote rows
  // ------------------------------------------------------------------
  // Save message in STREAMING state first so we have a messageId.
  const message = await db.message.create({
    data: {
      conversationId,
      role: "assistant",
      content: "",
      status: "STREAMING",
      coverage: [coverage] as object,
    },
  });
  const messageId = message.id;

  // Save all quotes (verified + unverified) with proper refs.
  const allForDb = [
    ...verified,
    ...unverified.map((u, i) => ({ ...u, ref: `U${i + 1}` })),
  ];
  if (allForDb.length > 0) {
    await db.quote.createMany({
      data: allForDb.map((q) => ({
        messageId,
        documentId,
        ref: q.ref,
        text: q.text,
        verified: q.verified,
        matchKind: q.verified ? q.matchKind : null,
        failReason: q.verified ? null : (q as UnverifiedQuote).failReason,
        ranges: q.verified ? ((q as VerifiedQuote).ranges as any) : undefined,
      })),
    });
  }

  // ------------------------------------------------------------------
  // 6. Emit quotes and coverage events
  // ------------------------------------------------------------------
  const quoteEventItems: QuoteEventItem[] = [
    ...verified.map(
      (q): QuoteEventItem => ({
        ref: q.ref,
        documentId,
        documentName,
        verified: true,
        matchKind: q.matchKind,
        failReason: null,
        text: q.text,
        pageStart: q.pageStart,
        pageEnd: q.pageEnd,
        occurrences: q.occurrenceCount,
      })
    ),
    ...unverified.map(
      (q, i): QuoteEventItem => ({
        ref: `U${i + 1}`,
        documentId,
        documentName,
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
  emit(encodeEvent({ type: "coverage", coverage: [coverage] }));

  // ------------------------------------------------------------------
  // 7. Compose (or deterministic not-found)
  // ------------------------------------------------------------------
  let finalContent = "";
  let finalStatus: "complete" | "stopped" | "error" = "complete";

  if (verified.length === 0) {
    // Deterministic not-found — no model call (Architecture §8, I-3).
    finalContent = coverage.complete
      ? notFoundComplete(documentName, coverage.chunksTotal)
      : notFoundPartial(
          documentName,
          coverage.chunksRead,
          coverage.chunksTotal,
          coverage.unreadablePages
        );
    emit(encodeEvent({ type: "token", text: finalContent }));
  } else {
    // Compose using ONLY verified quotes (I-3).
    emit(encodeEvent({ type: "status", stage: "composing" }));

    const verifiedRefs = new Set(verified.map((q) => q.ref));
    const filter = createCitationFilter(verifiedRefs);

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
                  { role: "system", content: composeSystemPrompt() },
                  {
                    role: "user",
                    content: composeUserMessage(
                      verified.map((q) => ({ ref: q.ref, text: q.text })),
                      documentName,
                      question
                    ),
                  },
                ],
              },
              { signal }
            )
          ),
        signal
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

      if (!signal.aborted) finalStatus = "complete";
    } catch (err: unknown) {
      if (signal.aborted) {
        finalStatus = "stopped";
      } else {
        finalStatus = "error";
        const errMsg =
          err instanceof Error ? err.message : "LLM call failed";
        emit(
          encodeEvent({
            type: "error",
            code: "LLM_UNAVAILABLE",
            message: errMsg,
          })
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 8. Persist final message state
  // ------------------------------------------------------------------
  await db.message.update({
    where: { id: messageId },
    data: {
      content: finalContent,
      status: finalStatus === "complete"
        ? "COMPLETE"
        : finalStatus === "stopped"
        ? "STOPPED"
        : "ERROR",
      coverage: [coverage] as object,
    },
  });

  emit(encodeEvent({ type: "done", messageId, status: finalStatus }));
  return messageId;
}

// ---------------------------------------------------------------------------
// Coverage helpers (re-exported for the route)
// ---------------------------------------------------------------------------
export type { CoverageDoc };
