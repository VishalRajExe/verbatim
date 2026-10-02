# Memory

Last updated: 2026-10-02 - Current phase: 5 (complete) - Next phase: 6 (Multi-document questions) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | complete | normalize.ts (NFKC+offset maps), views.ts (LRU cache), verify-quote.ts, locate.ts, split-ellipsis.ts, locate API, 26 unit + 20 integration tests |
| 3 Chat with one document | complete | LLM client/retry/limiter, tolerant JSON parser, QA pipeline (extract->verify->compose), cite-filter [Q#], NDJSON streaming route, conversation CRUD, chat UI with quote cards/steppers/coverage badges |
| 4 Large documents and coverage | complete | Paragraph/heading chunker with overlap (~24k tokens), parallel extraction with LLM_MAX_CONCURRENCY, section progress events, strict coverage object & honest absence (I-5), quote deduplication by canonical range, test failure hook, 150-page document verified, 100 tests passing |
| 5 Viewer and highlighting | **complete** | GET /api/documents/:id/rendition (PDF & converted DOCX with Range support), react-pdf-highlighter-extended integration, multi-line & cross-page linked highlights, repeated quote stepper re-locating, single short pulse with prefers-reduced-motion, keyboard navigation (Enter/Escape), 111 tests passing |
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
- Tests: npm test (vitest run) -- 111 tests across 15 suites, all passing

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

## Phase 5 files created/updated
- src/app/api/documents/[id]/rendition/route.ts -- GET rendition for PDF and converted DOCX with HTTP Range support
- src/components/viewer/types.ts -- ActiveQuoteTarget and viewer interface definitions
- src/components/viewer/pdf-viewer-inner.tsx -- Full client viewer with PdfLoader, PdfHighlighter, cross-page banners, stepper, zoom, and states
- src/components/viewer/pdf-viewer.tsx -- next/dynamic wrapper with ssr: false for clean client-side rendering
- src/components/chat/quote-card.tsx -- Added occurrence selection and stepper handlers
- src/components/chat/message-item.tsx -- Added occurrence index and full QuoteData passing
- src/components/chat/chat-view.tsx -- Passed QuoteData, activeOccurrenceIndex, and activeQuoteRef to message items
- src/components/chat/document-chat-container.tsx -- Side-by-side 3-column layout integrating PdfViewer and ChatView
- src/app/globals.css -- Added highlight color tokens (--mark, --mark-active, --mark-ring), pulse keyframes, and reduced-motion rules
- public/pdf.worker.min.mjs -- Bundled PDF.js web worker for local offline loading
- tests/viewer-rendition.test.ts -- 11 integration tests for rendition API, multi-line, cross-page, repeated quotes, and invariants

## Next steps
Phase 6 (Multi-document questions -- FR-6):
1. Multi-document selection UI in library and chat.
2. Comparative QA prompts (agree / differ / missing) across 2-5 documents.
3. Per-document verification and coverage badges.