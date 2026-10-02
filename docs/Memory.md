# Memory

Last updated: 2026-10-02 - Current phase: 4 (complete) - Next phase: 5 (Viewer and highlighting) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | complete | normalize.ts (NFKC+offset maps), views.ts (LRU cache), verify-quote.ts, locate.ts, split-ellipsis.ts, locate API, 26 unit + 20 integration tests |
| 3 Chat with one document | complete | LLM client/retry/limiter, tolerant JSON parser, QA pipeline (extract->verify->compose), cite-filter [Q#], NDJSON streaming route, conversation CRUD, chat UI with quote cards/steppers/coverage badges |
| 4 Large documents and coverage | **complete** | Paragraph/heading chunker with overlap (~24k tokens), parallel extraction with LLM_MAX_CONCURRENCY, section progress events, strict coverage object & honest absence (I-5), quote deduplication by canonical range, test failure hook, 150-page document verified, 100 tests passing |
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
- Tests: npm test (vitest run) -- 100 tests across 14 suites, all passing

## Verified facts about libraries & architecture
- OpenAI SDK & Gemini compatibility: Uses OpenAI-compatible endpoints with configurable baseURL and model via env. LLM calls wrapped with concurrency limiter (p-limit, default 2) and exponential backoff retry.
- LLM retry wrapper: Handles HTTP 429, 500, 503, and network errors. Max 4 attempts with exponential backoff + jitter; respects standard Retry-After headers in seconds.
- Tolerant JSON parser: Strips leading/trailing whitespace and ```json code fences; validates with Zod; triggers single repair attempt if invalid.
- Streaming citation filter: createCitationFilter buffers potential markers like `[Q` across token chunks; only verified citations `[Q1]` pass through; unverified or unknown markers are silently removed; partial markers on stream end are cleanly dropped.
- QA pipeline (Architecture §8, Rules §9):
  1. Chunk canonical text on paragraph/heading boundaries with overlap (~24,000 tokens / 96,000 chars target budget). Short documents remain a single chunk.
  2. Parallel extraction over all chunks via LLM_MAX_CONCURRENCY with progress event emission ("Reading section i of N").
  3. Verify every quote against canonical text via verifyQuote(). Unverified quotes are NEVER passed to the compose step (I-3).
  4. Dedup quotes across overlapping chunks by canonical start-end range.
  5. Assign sequential labels Q1...Qn for verified quotes, U1...Un for unverified quotes.
  6. Honest absence handling (Rule I-5): If 0 quotes found:
     - Complete coverage: "I couldn't find it in the document."
     - Partial coverage: "I couldn't find it in the sections I could read. Absence is not confirmed."
     - NEVER claim "There is no such clause" or "does not exist" when coverage is incomplete.
  7. Compose stream uses ONLY verified quotes with strict [Q#] references.
  8. Client abort (signal) terminates stream cleanly and persists partial response with status STOPPED (I-4).
- Coverage system:
  - `CoverageDoc`: tracks `chunksTotal`, `chunksRead`, `failedChunks`, `unreadablePages`, and boolean `complete`.
  - `complete` is strictly `true` only when `chunksRead === chunksTotal && failedChunks.length === 0 && unreadablePages === 0`.
  - UI badge displays: "Read all N sections, M pages" (complete) or "Read X of Y sections; absence is not confirmed" (partial).
- Test hook: `VERBATIM_TEST_FAIL_CHUNK` env variable allows forcing failure on a specific chunk index for automated tests; disabled/unset in production.
- Database persistence: Message and Quote records stored with full verification details; reload restores thread and quote cards.

## Phase 4 files created/updated
- src/lib/qa/chunker.ts -- Paragraph/heading chunker with overlap and token budgeting
- src/lib/qa/coverage.ts -- Coverage tracking with strict completion semantics
- src/lib/qa/prompts.ts -- Honest absence copy for complete and partial coverage
- src/lib/qa/pipeline.ts -- Parallel extraction across chunks, deduplication by canonical range, progress events, test hook
- src/components/chat/coverage-badge.tsx -- Dynamic badge showing section counts, page counts, and absence warnings
- src/lib/env.ts -- VERBATIM_TEST_FAIL_CHUNK test hook environment variable
- src/components/library/dropzone.tsx & src/app/page.tsx -- SWR mutate refresh and event handler prop fix across RSC boundary
- tests/fixtures/generate_150page_fixture.py -- Generator for 150-page synthetic legal PDF with embedded termination clause
- tests/fixtures/large_150p.pdf -- 150-page fixture document
- tests/chunker.test.ts -- 6 unit tests for chunking boundaries, budgets, and overlap
- tests/large-doc-coverage.test.ts -- 5 integration tests for 150-page ingestion, chunking, quote verification, forced chunk failure, and burst concurrency

## Next steps
Phase 5 (Viewer and highlighting -- FR-2, FR-3):
1. Embed PDF viewer (PDF.js canvas or SVG renderer) synchronized with page geometry.
2. Render verified citation highlights from bounding boxes stored in DB.
3. Interactive quote cards scrolling viewer to exact page and passage with 3px rule visual cue.