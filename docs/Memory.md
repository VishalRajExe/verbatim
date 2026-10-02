# Memory

Last updated: 2026-10-02 - Current phase: 7 (complete) - Next phase: 8 (Tracked-change redlining, Part C Option 1 - FR-8) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | complete | normalize.ts (NFKC+offset maps), views.ts (LRU cache), verify-quote.ts, locate.ts, split-ellipsis.ts, locate API, 26 unit + 20 integration tests |
| 3 Chat with one document | complete | LLM client/retry/limiter, tolerant JSON parser, QA pipeline (extract->verify->compose), cite-filter [Q#], NDJSON streaming route, conversation CRUD, chat UI with quote cards/steppers/coverage badges |
| 4 Large documents and coverage | complete | Paragraph/heading chunker with overlap (~24k tokens), parallel extraction with LLM_MAX_CONCURRENCY, section progress events, strict coverage object & honest absence (I-5), quote deduplication by canonical range, test failure hook, 150-page document verified, 100 tests passing |
| 5 Viewer and highlighting | complete | GET /api/documents/:id/rendition (PDF & converted DOCX with Range support), react-pdf-highlighter-extended integration, multi-line & cross-page linked highlights, repeated quote stepper re-locating, single short pulse with prefers-reduced-motion, keyboard navigation (Enter/Escape), 111 tests passing |
| 6 Multi-document questions | complete | Library multi-select (2-5 READY docs), route /ask, conversation kind "multi" with ConversationDocument join table, shared history across included docs, per-document independent extraction & verification (Rule I-7 / WRONG_DOCUMENT), comparative synthesis prompt (agree / differ / missing), per-document coverage badges, document-tagged quote cards, side-by-side multi-doc viewer with locate integration, 117 tests passing |
| 7 Document comparison | **complete** | Clause segmentation (clauses.ts), alignment with moved clause detection (align.ts), materiality token extraction & floor rules (materiality.ts), legal category taxonomy (categories.ts), batched AI summarization with automatic fallback (pipeline.ts), Comparison & ComparisonChange persistence with restart recovery, /api/comparisons routes with filtering/sorting, full /compare UI with inline word diff and locate() viewer integration, 137 tests passing |
| 8 Redlining (Part C, Option 1) | not started | Spike with @adeu/core, verify-edits, propose/apply/download routes, DOCX tracked changes |
| 9 Polish, deploy, README, video, note | not started | State audit, accessibility, copy pass, Docker, demo video, docs/NOTE.md |

## How to run
- Install: npm install
- Database: MySQL running on port 3306 (root:admin, database verbatim). Docker compose: docker compose up -d
- Migration: npx prisma migrate dev (or npx prisma db push)
- Dev server: npm run dev (serves http://localhost:3000)
- Health check: GET http://localhost:3000/api/health
- Typecheck: npm run typecheck (tsc --noEmit)
- Lint: npm run lint
- Build: npm run build
- Tests: npm test (vitest run) -- 137 tests across 19 suites, all passing

## Verified facts about libraries & comparison architecture
- Clause splitting (`src/lib/compare/clauses.ts`):
  - Segments text into clause units with exact `start` and `end` offsets in canonical text.
  - Recognizes numbered sections (`1.`, `1.1`, `4.2`), lettered (`(a)`, `a.`), labeled (`Article`, `Section`), ALL-CAPS headings, and Title Cased lines.
  - Returns `confidence` score (0.0 to 1.0) and `hasUncertainty: boolean`. Unstructured documents fall back to paragraph splitting with uncertainty declared in the UI.
- Clause alignment (`src/lib/compare/align.ts`):
  - Strict exact text match first; detects moved clauses using an optimal Longest Increasing Subsequence (LIS) algorithm that minimizes total displacement.
  - Pairs modified clauses by number/heading match (similarity >= 0.5) and character bigram-Dice similarity (threshold >= 0.6).
  - Unmatched clauses in A are classified as `REMOVED`; unmatched clauses in B as `ADDED`.
  - Cosmetic differences (varying only in case, punctuation, or numbering) are classified as `MODIFIED` with `significance: "COSMETIC"`.
- Materiality rules (`src/lib/compare/materiality.ts`):
  - Extracts currency amounts, durations with units (days, months, years), percentages, dates, obligation modal words (shall, must, may, will, shall not), negations, "unlimited" flag, and jurisdictions.
  - Any changed material token sets a minimum floor of `MEDIUM`.
  - Monetary amount change >= 2x triggers `HIGH`.
  - Directional change in `liability`, `payment`, `termination`, `indemnity`, or `governing_law` triggers `HIGH`.
  - Stylistic changes (e.g. "shall" <-> "will") in non-critical clauses remain `LOW`.
  - Deterministic invariant: AI may raise significance above the floor, but may NEVER lower it below the deterministic floor.
- Categories (`src/lib/compare/categories.ts`):
  - Keyword & pattern mapping for `liability`, `payment`, `termination`, `indemnity`, `confidentiality`, `governing_law`, `warranties`, `intellectual_property`, `dispute_resolution`, `data_protection`, and `general`.
- Batched AI pipeline (`src/lib/compare/pipeline.ts`):
  - Batches changes in groups of ~15 with LLM retry wrapper.
  - On LLM failure or rate limit: automatically falls back to deterministic token-diff summaries ("Amount changed from AED 100,000 to AED 1,000,000", etc.) labelled `summarySource: "automatic"`.
  - Overall summary synthesizes top changes and reports unchanged count.
- Storage & restart recovery (`src/lib/compare/service.ts`, `src/lib/jobs/recover.ts`, `src/lib/jobs/runner.ts`):
  - Comparison and ComparisonChange records persist clause offsets `aStart`, `aEnd`, `bStart`, `bEnd`.
  - In-flight comparisons in `QUEUED` or `RUNNING` status are automatically re-queued and recovered on server startup.
- Comparison UI (`/compare`):
  - Pickers for older and newer versions (only READY documents selectable).
  - Live progress and stage updates during processing.
  - Summary banner with stats pills and unchanged clause count ("N clauses identical", counted, not listed).
  - Filters for significance (High, Medium, Low, Cosmetic) and change type (Modified, Moved, Added, Removed).
  - Sorting: "Most significant first" and "Document order".
  - Word-level inline redline view using `diffWordsWithSpace` with strike-through deleted words and underlined added words.
  - "Open in older" and "Open in newer" buttons that trigger `PdfViewer` modal highlighting the exact clause passage via `locate()`.

## Known limitations (honest limits)
- **Proportional font interpolation**: Highlight edges can be off by a few characters in PDF viewer due to text item width interpolation.
- **DOCX formatting differences**: LibreOffice headless conversion may have slight visual differences compared to desktop Word.
- **Unstructured contracts**: Contracts lacking section numbering or distinct headings use paragraph-based fallback alignment with visible uncertainty notes.

## Phase 7 files created/updated
- src/lib/compare/clauses.ts -- Clause splitting with numbered, lettered, labeled, and heading detection with confidence scoring
- src/lib/compare/align.ts -- Clause alignment with bigram-Dice similarity, optimal LIS move detection, and cosmetic classification
- src/lib/compare/materiality.ts -- Material token extraction, 2x amount ratio rules, directional shifts, and deterministic floor enforcement
- src/lib/compare/categories.ts -- Legal category classification taxonomy
- src/lib/compare/pipeline.ts -- Batched AI summarization with automatic fallback on rate limit/failure, stats computation
- src/lib/compare/service.ts -- Background comparison service and database persistence
- src/lib/jobs/runner.ts -- Added enqueueComparison and waitForComparison to JobRunner
- src/lib/jobs/recover.ts -- Added recovery of unfinished comparisons on server restart
- src/app/api/comparisons/route.ts -- POST (launch comparison between 2 READY docs) and GET (list comparisons)
- src/app/api/comparisons/[id]/route.ts -- GET with filtering (significance, type, category) and sorting
- src/components/compare/word-diff.tsx -- Inline word-level diff component using diffWordsWithSpace
- src/components/compare/change-card.tsx -- Change card component with badges, word diff, and locate viewer actions
- src/app/compare/page.tsx -- Full /compare page with pickers, progress, summary, filters, and slide-over viewer
- src/components/library/document-list.tsx -- Added "Compare versions" action when 2 documents are selected
- tests/fixtures/compare-contracts.ts -- Test fixture pair covering all 5 required conditions
- tests/compare.test.ts -- 14 unit tests for splitting, alignment, materiality, categories, and AI fallback
- tests/compare-api.test.ts -- 5 integration tests for /api/comparisons endpoints, filtering, and sorting
- tests/large-doc-compare.test.ts -- 150-page equivalent contract pair comparison test

## Next steps
Phase 8 (Tracked-change redlining, Part C Option 1 - FR-8):
1. Spike @adeu/core: apply one edit to a sample DOCX, confirm tracked change in LibreOffice.
2. lib/redline/view.ts & propose.ts: text view of DOCX, locate clauses, request minimal edits.
3. verify-edits.ts: verify target occurs exactly once before proposing.
4. apply.ts & validate-docx.ts: apply edits (w:ins / w:del), validate untouched XML, LibreOffice conversion smoke test.
5. UI and routes: propose, apply, download.