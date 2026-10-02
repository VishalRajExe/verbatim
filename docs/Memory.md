# Memory

Last updated: 2026-10-02 - Current phase: 3 (complete) - Next phase: 4 (Large documents and coverage) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | complete | normalize.ts (NFKC+offset maps), views.ts (LRU cache), verify-quote.ts, locate.ts, split-ellipsis.ts, locate API, 26 unit + 20 integration tests |
| 3 Chat with one document | **complete** | LLM client/retry/limiter, tolerant JSON parser, QA pipeline (extract->verify->compose), cite-filter [Q#], NDJSON streaming route, conversation CRUD, chat UI with quote cards/steppers/coverage badges, 89 total tests passing |
| 4 Large documents and coverage | not started | |
| 5 Viewer and highlighting | not started | |
| 6 Multi-document questions | not started | |
| 7 Document comparison | not started | |
| 8 Redlining (Part C, Option 1) | not started | |
| 9 Polish, deploy, README, video, note | not started | |

## How to run
- Install: npm install
- Database: MySQL running on port 3306 (root:admin, database verbatim). Docker compose: docker compose up -d
- Migration: npx prisma migrate dev (or npx prisma db push)
- Dev server: npm run dev (serves http://localhost:3000)
- Health check: GET http://localhost:3000/api/health
- Typecheck: npm run typecheck (tsc --noEmit)
- Build: npm run build
- Tests: npm test (vitest run) -- 89 tests across 12 suites, all passing

## Verified facts about libraries & architecture
- OpenAI SDK & Gemini compatibility: Uses OpenAI-compatible endpoints with configurable baseURL and model via env. LLM calls wrapped with concurrency limiter (p-limit, default 2) and exponential backoff retry.
- LLM retry wrapper: Handles HTTP 429, 500, 503, and network errors. Max 4 attempts with exponential backoff + jitter; respects standard Retry-After headers in seconds.
- Tolerant JSON parser: Strips leading/trailing whitespace and ```json code fences; validates with Zod; triggers single repair attempt if invalid.
- Streaming citation filter: createCitationFilter buffers potential markers like `[Q` across token chunks; only verified citations `[Q1]` pass through; unverified or unknown markers are silently removed; partial markers on stream end are cleanly dropped.
- QA pipeline (Architecture §8, Rules §9):
  1. Extract quotes from chunks (no positions requested, prompt injection delimiters).
  2. Verify every quote against canonical text via verifyQuote(). Unverified quotes are NEVER passed to the compose step (I-3).
  3. Dedup verified quotes by canonical start-end range.
  4. Assign sequential labels Q1...Qn for verified quotes, U1...Un for unverified quotes.
  5. If verified quotes count is 0, deterministic "couldn't find" text is returned immediately without a model compose call.
  6. Compose stream uses ONLY verified quotes with strict [Q#] references.
  7. Client abort (signal) terminates stream cleanly and persists partial response with status STOPPED (I-4).
- Database persistence: Message and Quote records stored with full verification details; reload restores thread and quote cards.

## Phase 3 files created
- src/lib/llm/client.ts -- OpenAI client singleton with env validation
- src/lib/llm/retry.ts -- Exponential backoff retry with Retry-After support
- src/lib/llm/limiter.ts -- p-limit concurrency limiter and abort-aware sleep
- src/lib/llm/json.ts -- Tolerant code fence stripping, Zod validation, LLM repair function
- src/lib/qa/prompts.ts -- Untrusted-data delimiter prompts for extract and compose
- src/lib/qa/schemas.ts -- Zod schemas for LLM JSON outputs
- src/lib/qa/chunker.ts -- Single-chunk document chunker (base for Phase 4)
- src/lib/qa/coverage.ts -- CoverageDoc tracking chunks read/failed and complete flag
- src/lib/qa/cite-filter.ts -- Streaming-safe [Q#] citation filter
- src/lib/qa/ndjson-events.ts -- NDJSON event definitions, encoder, and buffer parser
- src/lib/qa/pipeline.ts -- Orchestrator for extract -> verify -> dedup -> compose pipeline
- src/app/api/conversations/route.ts -- POST create conversation, GET list conversations by documentId
- src/app/api/conversations/[id]/route.ts -- GET single conversation with quotes, DELETE conversation
- src/app/api/conversations/[id]/messages/route.ts -- POST streaming NDJSON message route with abort handling
- src/components/chat/quote-card.tsx -- Quote card with 3px rule, serif text, verification badge, occurrence stepper
- src/components/chat/answer-content.tsx -- Rendered answer with interactive [Q#] citation chips
- src/components/chat/coverage-badge.tsx -- Complete/partial read coverage badge
- src/components/chat/message-item.tsx -- Thread message item with stages, quotes, answer, and error/retry
- src/components/chat/conversation-rail.tsx -- Sidebar rail with chat history, new chat, and delete
- src/components/chat/chat-view.tsx -- Interactive chat view with streaming reader, stop button, composer
- src/components/chat/document-chat-container.tsx -- Container linking rail and chat view
- src/app/documents/[id]/page.tsx -- Document chat page with ready-status guarding
- tests/cite-filter.test.ts -- 6 unit tests for citation filtering across token boundaries
- tests/llm-json.test.ts -- 8 unit tests for code fence stripping and repair flows
- tests/llm-retry.test.ts -- 7 unit tests for retry backoff, Retry-After, and abort
- tests/chat-pipeline.test.ts -- 5 integration tests for pipeline, routes, not-found path, unverified quote isolation, and stop

## Next steps
Phase 4 (Large documents and coverage -- FR-4):
1. Expand chunker.ts to chunk large documents (~CHUNK_TOKENS ~800 tokens) on paragraph/heading boundaries with overlap.
2. Parallel extract across chunks using LLM_MAX_CONCURRENCY.
3. Emit progress events "Reading section i of N".
4. Update coverage badge for partial reads and test hook for chunk failure.