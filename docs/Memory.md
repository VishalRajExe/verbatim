# Memory

Last updated: 2026-10-02 - Current phase: 6 (complete) - Next phase: 7 (Document comparison) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | complete | normalize.ts (NFKC+offset maps), views.ts (LRU cache), verify-quote.ts, locate.ts, split-ellipsis.ts, locate API, 26 unit + 20 integration tests |
| 3 Chat with one document | complete | LLM client/retry/limiter, tolerant JSON parser, QA pipeline (extract->verify->compose), cite-filter [Q#], NDJSON streaming route, conversation CRUD, chat UI with quote cards/steppers/coverage badges |
| 4 Large documents and coverage | complete | Paragraph/heading chunker with overlap (~24k tokens), parallel extraction with LLM_MAX_CONCURRENCY, section progress events, strict coverage object & honest absence (I-5), quote deduplication by canonical range, test failure hook, 150-page document verified, 100 tests passing |
| 5 Viewer and highlighting | complete | GET /api/documents/:id/rendition (PDF & converted DOCX with Range support), react-pdf-highlighter-extended integration, multi-line & cross-page linked highlights, repeated quote stepper re-locating, single short pulse with prefers-reduced-motion, keyboard navigation (Enter/Escape), 111 tests passing |
| 6 Multi-document questions | **complete** | Library multi-select (2-5 READY docs), route /ask, conversation kind "multi" with ConversationDocument join table, shared history across included docs, per-document independent extraction & verification (Rule I-7 / WRONG_DOCUMENT), comparative synthesis prompt (agree / differ / missing), per-document coverage badges, document-tagged quote cards, side-by-side multi-doc viewer with locate integration, 117 tests passing |
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
- Tests: npm test (vitest run) -- 117 tests across 16 suites, all passing

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
     - Complete coverage: "I couldn't find it in the document." (single-doc) or "I couldn't find a passage that answers this in any of the documents (docA, docB all read)." (multi-doc).
     - Partial coverage: "I couldn't find it in the sections I could read. Absence is not confirmed."
     - NEVER claim "There is no such clause" or "does not exist" when coverage is incomplete.
  7. Compose stream uses ONLY verified quotes with strict [Q#] references. For multi-document questions, comparative prompts identify similarities, differences, and missing terms.
  8. Client abort (signal) terminates stream cleanly and persists partial response with status STOPPED (I-4).
- Coverage system:
  - `CoverageDoc`: tracks `documentId`, `documentName`, `chunksTotal`, `chunksRead`, `failedChunks`, `unreadablePages`, and boolean `complete`.
  - `complete` is strictly `true` only when `chunksRead === chunksTotal && failedChunks.length === 0 && unreadablePages === 0`.
  - UI badge displays: "Read all N sections, M pages" (single doc) or "docName.pdf: read all N sections" (multi-doc complete) or "docName.pdf: read X of Y sections; absence is not confirmed" (partial).
- Multi-document questions (FR-6):
  - Library multi-select allows choosing 2 to 5 READY documents.
  - Route `/ask` supports querying across chosen contracts.
  - Conversations with `kind: "multi"` link to documents via `ConversationDocument`.
  - Shared history: multi-document conversations appear in each participating document's conversation history.
  - Per-document extraction and verification: each quote carries `documentId` and is verified strictly against that document alone (Rule I-7). If a quote from Document B is attributed to Document A, `verifyQuote()` detects that it is absent from A but present in B, returning `failReason: "WRONG_DOCUMENT"` with `verified: false`.
  - Quote cards in chat display the document name pill, and clicking a quote opens the correct document's PDF rendition in the side-by-side viewer.
- Test hook: `VERBATIM_TEST_FAIL_CHUNK` env variable allows forcing failure on a specific chunk index for automated tests; disabled/unset in production.
- Database persistence: Message and Quote records stored with full verification details; reload restores thread and quote cards.

## Verified working API details: react-pdf-highlighter-extended (v8.1.0)
- `PdfLoader`:
  - `document`: URL string (e.g. `/api/documents/:id/rendition`), TypedArray, or DocumentInitParameters.
  - `workerSrc`: configured to `/pdf.worker.min.mjs` (served locally from `public/` for offline reliability).
  - Callbacks: `beforeLoad`, `errorMessage`, `onError`, and child function `(pdfDocument: PDFDocumentProxy) => ReactNode`.
- `PdfHighlighter`:
  - Receives `pdfDocument`, `pdfScaleValue` (numbers like 1.15 or string "page-width"), `highlights: Array<Highlight>`, `utilsRef: (utils: PdfHighlighterUtils) => void`.
  - Context hook `useHighlightContainerContext()` exposes `highlight`, `isScrolledTo`, `viewportToScaled`, `screenshot`.
- Coordinate representation (`Scaled` and `ScaledPosition`):
  - `Scaled`: `{ x1, y1, x2, y2, width, height, pageNumber }` (1-indexed page number; coordinates pre-computed in viewport scale 1 top-left origin).
  - `ScaledPosition`: `{ boundingRect: Scaled, rects: Array<Scaled>, usePdfCoordinates: false }`.
  - Coordinates from server `locate()` map directly into `ScaledPosition` without loss.
- Highlighting & Scrolling:
  - `highlighterUtils.scrollToHighlight(highlight)` autoscrolls the viewport to target highlight.
  - Multi-line quotes: `locate()` returns merged per-line rects; `TextHighlight` renders every rect in `position.rects`.
  - Cross-page quotes: linked highlights created on both pages; viewer scrolls to first page and displays `"Passage continues on page N"`.
  - Repeated quotes: stepper ("Appears N times, showing X of N") allows stepping between matches and re-locates target occurrence.
- Theming & Interaction:
  - Base highlight: `.TextHighlight__part` styled with `var(--mark)` (`rgba(255, 200, 40, 0.45)`).
  - Active match: `.TextHighlight--scrolledTo .TextHighlight__part` styled with `var(--mark-active)` (`rgba(255, 200, 40, 0.75)`) and `1.5px solid var(--mark-ring)` (`#C98A00`).
  - Single pulse animation: `highlight-pulse` runs once on scroll (600ms); disabled when `prefers-reduced-motion: reduce`.
  - Keyboard: quote cards are focusable (`tabIndex={0}`) and open on `Enter` / `Space`; viewer closes on `Escape`.

## Known limitations (honest limits)
- **Text-item character interpolation**: Sub-item positions are interpolated from item width and character offset. With proportional fonts, the highlight edges at the start and end of a quote can be off by a few characters.
- **DOCX layout differences**: LibreOffice headless conversion may have slight pagination/wrapping differences compared to Microsoft Word desktop rendering. The viewer displays the exact converted PDF rendition that canonical text was extracted from.

## Phase 6 files created/updated
- src/app/ask/page.tsx -- Route /ask for querying across 2 to 5 READY documents
- src/components/chat/multi-doc-chat-container.tsx -- Multi-document chat container with document list, history, and side-by-side viewer
- src/components/library/document-list.tsx -- Multi-document selection checkboxes and "Ask across documents" floating action bar
- src/app/api/conversations/route.ts -- Multi-document conversation creation (`kind: "multi"` with `ConversationDocument`) and shared history
- src/app/api/conversations/[id]/route.ts -- Includes document names in quote payload for reload
- src/app/api/conversations/[id]/messages/route.ts -- Validates all conversation documents and passes to pipeline
- src/lib/qa/pipeline.ts -- Multi-document independent extraction, per-document verification (I-7), and comparative compose
- src/lib/qa/prompts.ts -- Comparative synthesis prompt (similarities, differences, missing provisions) and multi-doc honest absence
- src/components/chat/quote-card.tsx -- Displays documentName tag on each quote card
- src/components/chat/coverage-badge.tsx -- Displays per-document coverage badge with document name
- src/components/chat/conversation-rail.tsx -- Displays Multi badge for multi-doc conversations in rail
- tests/multi-doc.test.ts -- 6 integration tests covering validation, shared history, WRONG_DOCUMENT, extraction, honest absence, and viewer location

## Next steps
Phase 7 (Document comparison -- FR-7):
1. lib/compare/clauses.ts & align.ts: split into numbering/heading units, align added, removed, modified, moved, cosmetic.
2. materiality.ts & categories.ts: token floor rules (numbers, currency, dates, obligations), clause category map.
3. Comparative AI pass in batches with automatic deterministic fallbacks.
4. UI: document picker, comparison diff view with significance tags and filters.