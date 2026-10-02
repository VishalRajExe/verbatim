# Memory

Last updated: 2026-10-02 - Current phase: 2 (complete) - Next phase: 3 (Chat with one document) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | **complete** | normalize.ts (NFKC+offset maps), views.ts (LRU cache), verify-quote.ts, locate.ts, split-ellipsis.ts, locate API, 26 unit + 20 integration tests (63 total) |
| 3 Chat with one document | not started | |
| 4 Large documents and coverage | not started | |
| 5 Viewer and highlighting | not started | |
| 6 Multi-document questions | not started | |
| 7 Document comparison | not started | |
| 8 Redlining (Part C, Option 1) | not started | |
| 9 Polish, deploy, README, video, note | not started | |

## How to run
- Install: npm install
- Database: MySQL running on port 3306 (root:admin, database verbatim). Docker compose: docker compose up -d
- Migration: npx prisma migrate dev
- Dev server: npm run dev (serves http://localhost:3000)
- Health check: GET http://localhost:3000/api/health
- Typecheck: npm run typecheck (tsc --noEmit)
- Lint: npm run lint (next lint)
- Tests: npm test (vitest run) -- 63 tests across 8 suites, all passing

## Verified facts about libraries
- pdfjs-dist Ligature extraction: Helvetica in pdfjs may map U+FB01 (fi-ligature) to "nn" not "fi". NFKC normalisation verified at unit level; integration fixtures use plain ASCII.
- MySQL P2034 deadlock: MySQL REPEATABLE READ causes deadlocks on concurrent transactions; retry up to 3x with 300ms*attempt backoff in pipeline.
- errorMessage truncation: Prisma errors can exceed VARCHAR(191); truncate to 500 chars before saving to errorMessage column.
- normalise() offset maps: map[i] = source offset. Sentinel map[s.length] = source.length. Leading whitespace not emitted (only emits space when finalChars.length > 0).
- joinView() de-hyphenation: Only removes hyphen+space when left char matches /\p{L}/u and right char matches /\p{Ll}/u.
- looseKey(): ONLY used as tertiary fallback. Never primary or secondary.
- getViews() LRU: 50-entry cache keyed by documentId.
- verifyQuote() order: keep -> join -> loose. matchKind "exact" for keep/join, "loose" for loose key.
- verifyQuote() WRONG_DOCUMENT: uses findMany across ALL other DocumentText rows, not findFirst.
- locate() line merging: items with y1 within 2px are merged into one rect per line.
- GET /api/documents/:id/locate?ranges=start-end returns { highlights: PageHighlight[] }.

## Phase 2 files created
- src/lib/text/normalize.ts -- NFKC normalisation with per-char offset maps
- src/lib/text/views.ts -- LRU-cached keep/join/loose views per document
- src/lib/verify/split-ellipsis.ts -- splits quotes on ... and [...] markers
- src/lib/verify/verify-quote.ts -- main verifyQuote() engine (no fuzzy matching, I-4)
- src/lib/verify/locate.ts -- locate() converts char ranges to page rectangles
- src/app/api/documents/[id]/locate/route.ts -- GET endpoint for locate
- tests/normalize.test.ts -- 26 pure unit tests for normalise, joinView, looseKey, splitEllipsis
- tests/verify.test.ts -- 20 integration tests covering FR-3.1 to FR-3.7 plus passage and paraphrase
- tests/fixtures/contract_a.pdf -- 3-page synthetic contract with all edge cases
- tests/fixtures/contract_b.pdf -- 1-page contract for WRONG_DOCUMENT test
- tests/fixtures/generate_phase2_fixtures.py -- reportlab script to regenerate fixtures

## Decisions (with reason)
- verifyQuote searches ALL other docs for WRONG_DOCUMENT (not findFirst): resilient to test DB pollution from previous runs.
- join view condition: both /\p{L}/u (left) and /\p{Ll}/u (right) required: avoids stripping legitimate compound-word hyphens.
- 50-entry LRU cache for views: avoids recomputing 10MB normalised views on every quote check without unbounded memory.
- Pipeline transaction retry (3x, P2034): MySQL REPEATABLE READ deadlocks are transient; retry with backoff is the standard mitigation.

## Known problems
- MySQL P2034 deadlock warning appears in test logs when ingest.test.ts and verify.test.ts run concurrently. Recoverable; all 63 tests pass.

## Next steps
Phase 3 (Chat with one document -- FR-2):
1. LLM prompt: send canonical text chunks and request answers with [Q#] citation markers.
2. Streaming route: POST /api/conversations/:id/messages using server-sent events.
3. Call verifyQuote() for each [Q#] marker; persist Quote rows with verified flag.
4. Chat UI: message thread, streaming display, verified/unverified quote badges, Stop button, coverage badge.
5. Record conversation history per document in Conversation and Message tables.