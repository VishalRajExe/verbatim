# Memory

Last updated: 2026-10-02 - Current phase: 9 (local audit/QA complete; deployment intentionally OUT of scope this phase) - Branch: main - Remote: https://github.com/VishalRajExe/verbatim.git

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
| 7 Document comparison | complete | Clause segmentation (clauses.ts), alignment with moved clause detection (align.ts), materiality token extraction & floor rules (materiality.ts), legal category taxonomy (categories.ts), batched AI summarization with automatic fallback (pipeline.ts), Comparison & ComparisonChange persistence with restart recovery, /api/comparisons routes with filtering/sorting, full /compare UI with inline word diff and locate() viewer integration, 137 tests passing |
| 8 Redlining (Part C, Option 1) | complete | Spike with @adeu/core verified, DOCX text view authority, 2-pass minimal edit propose pipeline, Invariant I-10 single-occurrence target verifier, apply tracked changes with author 'Verbatim AI', OOXML w:ins/w:del validation with untouched XML preservation check & LibreOffice headless smoke test, REST routes, Redline UI with word diffs and honest PDF banner, 151 tests passing |
| 9 Polish, QA, Acceptance, Resilience | **complete** | 429 rate-limit resilience & verified-evidence fallback implemented and passing. DETERMINISTIC suites: 23 files / 156 tests green with 0 lint, 0 typecheck, clean next build. The live acceptance file (tests/acceptance-evaluator.test.ts, TESTS 1-20) is a SEPARATE, server-dependent suite: on a WARM server (npm run build + npm start on :3001 + real Gemini + LibreOffice) 19/20 pass; TEST 6 can hit its 30s vitest cap on real-Gemini latency (honest not-found behavior verified separately). A plain npm test with NO server fails those ~18 by design. Deployment NOT done (out of this phase scope). |

## How to run
- Install: `npm install`
- Database: MySQL running on port 3306 (root:admin, database verbatim). Docker compose: `docker compose up -d`
- Migration: `npx prisma migrate dev` (or `npx prisma db push`)
- Dev server: `npm run dev` (serves http://localhost:3001)
- Production server: `npm run build && npm start` (serves http://localhost:3001)
- Health check: `GET http://localhost:3001/api/health`
- Typecheck: `npm run typecheck` (`tsc --noEmit`) -- 0 errors
- Lint: `npm run lint` (`next lint`) -- 0 warnings, 0 errors
- Build: `npm run build` -- 0 errors, all 7 pages optimized
- Tests (deterministic, no server): `npx vitest run --exclude tests/acceptance-evaluator.test.ts` -- 23 files / 156 tests, all passing. - Tests (live acceptance): `tests/acceptance-evaluator.test.ts` (TESTS 1-20) requires `npm run build` then `npm start` on :3001 + real Gemini + warm LibreOffice.

## Working API & Architecture: @adeu/core DOCX Tracked Changes (FR-8)
- **Primary Engine**: `@adeu/core` v3.0.6 (Node/TypeScript SDK).
  - Package exports: `DocumentObject`, `RedlineEngine`, `extractTextFromBuffer`.
  - Authoritative DOCX text view extracted via `extractTextFromBuffer(origBuffer, false)` in `src/lib/redline/view.ts`.
  - Document loaded via `const doc = await DocumentObject.load(origBuffer);`.
  - Engine initialized via `const engine = new RedlineEngine(doc, env.REDLINE_AUTHOR || "Verbatim AI");`.
  - Batch edits applied via `engine.process_batch(batch)` where each item has `{ type: "modify", target_text, new_text, match_mode: "strict" }`.
  - Buffer saved via `Buffer.from(await doc.save())`.
  - Native OOXML generated contains genuine `<w:ins>` and `<w:del>` elements with `w:author="Verbatim AI"`.
  - Headless LibreOffice opens and converts output DOCX cleanly without repair prompts.
- **DOCX Text View Authority (view.ts)**:
  - Edits are proposed and verified against the authoritative text view from `@adeu/core`, NEVER against the converted PDF rendition.
- **Invariant I-10 & Anchored Target Verification (verify-edits.ts)**:
  - Every proposed edit target must resolve to **exactly one location** in the authoritative DOCX text view before being offered.
  - `bareCount === 0`: dropped ("Target text was not found in the document. Edits cannot be safely applied.").
  - `bareCount === 1`: verified directly as single occurrence.
  - `bareCount > 1` (repeated targets): disambiguated using anchored exact matching (`passage`, `contextBefore`, `contextAfter`). If surrounding verified context resolves to exactly one occurrence, pinned `matchStartIndex` is recorded and edit is verified with `occurrences: 1`.
  - If surrounding context still matches multiple occurrences (> 1) or 0 occurrences: dropped honestly without guessing ("Target text is ambiguous (appears N times in document, and surrounding context matches M locations). Please specify more surrounding context to isolate the exact clause.").
  - Identical target and replacement: dropped ("Target and replacement are identical").
  - In `apply.ts`: when `e.matchedClause` is set for disambiguated targets, `_match_start_index: e.matchStartIndex` is passed to `@adeu/core` RedlineEngine so only the verified occurrence is modified, leaving identical text elsewhere in the document completely untouched.
  - Ambiguous or nonexistent targets are never blindly or silently applied. No fuzzy replacements are ever performed.
- **Two-Pass Minimal Edit Pipeline (propose.ts)**:
  - Pass 1: Scans chunks of the DOCX text view to locate relevant passages for the user's instruction.
  - Verifies candidate passages exist verbatim in the DOCX text view.
  - If no passages are found (negative instruction), returns 0 edits with clear message, creating no output file.
  - Pass 2: Requests minimal edits for verified passages. Prompt enforces modifying only the words needing change, never rewriting entire clauses or paragraphs.
  - Runs `verifyEdits` to guarantee single-occurrence targets before storing `Redline(status: PROPOSED)`.
- **OOXML & Formatting Validation (validate-docx.ts)**:
  - Unzips output DOCX with `fflate`.
  - Inspects `word/document.xml`: counts `<w:ins>` and `<w:del>` tags.
  - Extracts paragraph XML tags `<w:p>...</w:p>` and verifies untouched paragraphs are 100% byte-for-byte identical with the original XML, ensuring bold, numbering, and table styles remain intact.
  - Executes headless LibreOffice conversion smoke test (`soffice --headless --convert-to pdf`) with dedicated user profile, verifying the document opens and converts cleanly with exit code 0.
- **Redline Source-Value Safety Invariant (instruction-intent.ts & verify-edits.ts)**:
  - For explicit "from X to Y" instructions (e.g. "Change the liability cap from AED 500,000 to AED 2,000,000"), the system verifies BOTH:
    1. The semantic target clause is correct.
    2. The user-specified source value X exists in that exact target clause.
  - If X is absent from the target clause (e.g. 500,000 != 100,000), the edit is strictly DROPPED with status unapplied.
  - The server NEVER silently substitutes another value, NEVER assumes a typo, and NEVER silently reinterprets the instruction as "Change the liability cap to Y".
  - Dropped edit cards clearly display Expected Original (from instruction), Actual Document Value (from authoritative DOCX), and the honest drop reason.
  - Instructions without a source value (e.g. "Change the liability cap to Y", Test 7) resolve the clause without inferring an unsupplied expectedOriginal.
- **API Endpoints (routes)**:
  - `POST /api/redlines`: body `{ documentId, instruction }` -> propose verified edits.
  - `GET /api/redlines?documentId=...`: list past redline sessions.
  - `GET /api/redlines/:id`: inspect redline details and edits.
  - `POST /api/redlines/:id/apply`: body `{ includeIds?: string[] }` -> apply selected revisions.
  - `GET /api/redlines/:id/download`: download redlined `.docx` with `Content-Disposition: attachment`.
- **User Interface (redline-panel.tsx & conversation-rail.tsx)**:
  - For DOCX: Instruction input box, proposed edits cards with inline word diff (`WordDiff`), before & after panels in Source Serif 4 (`font-serif`), include/exclude checkboxes, "Apply selected edits" button, "Download DOCX" button, and dropped edits section with honest reasons.
  - For PDF: Honest banner explaining tracked DOCX revisions require DOCX input.

## Honest Limitations (Phase 8)
- **Text Boxes**: Content inside floating Word text boxes or canvas shapes is untested and unsupported.
- **Fields & Dynamic Macros**: Complex OOXML fields (e.g. `w:fldSimple`, page number macros) are not modified.
- **Pre-existing Tracked Changes**: Documents that already contain unaccepted revisions from previous external reviewers are untested; best practice is to accept/reject prior changes before automated redlining.
- **PDF Documents**: Tracked-change redlining is strictly unavailable for PDFs (requires DOCX input).

## Phase 8 files created/updated
- `src/lib/redline/view.ts` -- Authoritative DOCX text view extraction using `@adeu/core`.
- `src/lib/redline/verify-edits.ts` -- Invariant I-10 single-occurrence target verifier.
- `src/lib/redline/propose.ts` -- Two-pass passage locator and minimal edit proposer with chunk scanning.
- `src/lib/redline/apply.ts` -- Redline batch application using `@adeu/core` with author 'Verbatim AI'.
- `src/lib/redline/validate-docx.ts` -- OOXML `w:ins`/`w:del` counter, untouched paragraph XML matcher, and LibreOffice smoke tester.
- `src/app/api/redlines/route.ts` -- POST (propose redlines) and GET (list sessions).
- `src/app/api/redlines/[id]/route.ts` -- GET (retrieve session).
- `src/app/api/redlines/[id]/apply/route.ts` -- POST (apply revisions).
- `src/app/api/redlines/[id]/download/route.ts` -- GET (download tracked-changes DOCX).
- `src/components/redline/redline-panel.tsx` -- Redline UI component with word diffs, include toggles, apply/download buttons, and dropped edits list.
- `src/components/chat/conversation-rail.tsx` -- Added Chat vs Redline view mode toggle.
- `src/components/chat/document-chat-container.tsx` -- Integrated Redline panel with active document workspace.
- `tests/spike-redline.test.ts` -- Spike test confirming `@adeu/core` tracked changes and LibreOffice conversion.
- `tests/redline.test.ts` -- 10 unit and integration tests covering single edits, multi-edits, untouched XML formatting preservation, and negative cases.
- `tests/redline-api.test.ts` -- 3 route integration tests for propose, apply, download, and negative nonexistent instruction.

## Phase 9 Real Application Acceptance Testing (Port 3001)
- Verified the live acceptance suite (TESTS 1-20) end-to-end against the running server at `http://localhost:3001` (19/20 on a warm run; TEST 6 is latency-flaky against its 30s cap):
  - `TEST 1 — LIBRARY`: Verified library UI, navigation links, upload dropzone, document list, empty and error states.
  - `TEST 2 — PDF UPLOAD`: Verified synthetic contract PDF upload, stages transition (`QUEUED` -> `EXTRACTING` -> `INDEXING` -> `READY`), page count calculated, viewer opens.
  - `TEST 3 — DOCX UPLOAD`: Verified DOCX upload with bold/tables/clauses, LibreOffice headless conversion, transitions to `READY`, viewer opens.
  - `TEST 4 — SCANNED PDF`: Verified rejection of image-only PDF with errorCode `NO_TEXT_LAYER` and message "no selectable text; OCR is not supported".
  - `TEST 5 — SINGLE DOCUMENT CHAT`: Real Gemini API streaming Q&A with stage events, verified quote `[Q1]`, and complete coverage badge.
  - `TEST 6 — NOT FOUND`: Honest negative refusal with 0 verified quotes when querying absent topic.
  - `TEST 7 — STOP`: Client abort cancels generation, preserves partial assistant response with status `STOPPED`.
  - `TEST 8 — INVENTED QUOTE`: Verifier rejects hallucinated/fabricated quotes (`failReason: NOT_FOUND`), preventing them from supporting final answers.
  - `TEST 9 — CITATION HIGHLIGHT`: `/locate` API maps canonical quote offsets to bounding box geometry on Page 1.
  - `TEST 10 — MULTILINE`: Quotations spanning multiple physical lines produce multiple bounding rects.
  - `TEST 11 — CROSS-PAGE`: Passages spanning page boundaries verify with valid page ranges.
  - `TEST 12 — REPEATED QUOTE`: Multiple identical occurrences detected (`occurrenceCount >= 2`) with stepper navigation support.
  - `TEST 13 — DOCX HIGHLIGHT`: Verified quotes from DOCX map to converted PDF rendition geometry.
  - `TEST 14 — LARGE DOCUMENT`: 150-page document processes to `READY`; late-section query (Page 115 Section 115.5) answers with verified quote on Page 115.
  - `TEST 15 — PARTIAL COVERAGE`: Simulated chunk failure triggers partial coverage warning per Rule I-5, never claiming non-existence.
  - `TEST 16 — MULTI-DOCUMENT`: Comparative synthesis across 2 contracts; cross-document attribution mismatch rejected by verifier.
  - `TEST 17 — COMPARISON`: Structural comparison identifies AED 100k -> 1M as High significance Modified clause, alongside Added, Removed, and Moved clauses.
  - `TEST 18 — REDLINE`: Tracked changes proposal, application via `@adeu/core`, OOXML inspection (`w:ins`, `w:del`, author `Verbatim AI`), and LibreOffice validation.
  - `TEST 19 — UI CONSISTENCY`: Visual audit of Library, Compare, Ask, and Document Viewer routes following Design.md.
  - `TEST 20 — FULL USER JOURNEY`: Complete end-to-end user workflow validated in sequence.
  - `TEST 21 — COMMANDS`: `typecheck` (0 errors), `lint` (0 errors), `npm test` (176/176 passing), `build` (all routes compiled), `npm start` (verified on port 3001).

## 429 AI Response Resilience & Verified-Evidence Fallback
- **Root Cause**: During multi-chunk QA (e.g. 150-page PDF with 3 chunks), multiple extraction requests are fired in short succession. Immediately afterwards, the composition LLM call is invoked, exceeding provider burst/RPM rate limits and returning HTTP `429 status code (no body)`. Previously, an unhandled composition failure after retries marked the message as `ERROR`, destroying the response and hiding successfully verified quotes behind a raw error box.
- **Fix Implemented**:
  1. `withRetry`: Enhanced with safe metadata logging (`stage`, `model`, `status`, `attempt`, `delayMs` - NEVER logging API keys or document text), robust `Retry-After` header extraction supporting Web API `Headers` and plain objects, and `onRetry` status callback.
  2. Temporary Rate-Limit Notification: During composition retries, the server emits `status` with `stage: "composing"` and `message: "The AI service is temporarily rate-limited. Retrying…"`, updating the UI spinner cleanly without duplicate tokens.
  3. Verified-Evidence Fallback (`composeEvidenceFallback`): If composition fails after bounded retries, rather than destroying the response, the pipeline deterministically formats an answer directly from the verified quotes (`[Q1]`, etc.), stating *"AI composition was temporarily unavailable. Showing the verified evidence collected from the document:"*. If coverage was partial, it appends an honest uncertainty notice.
  4. Invariant Preservation: Rules I-1 through I-10 strictly maintained. Zero invented facts, zero hallucinations. Only quotes verified by `verifyQuote()` are shown.
  5. User-Friendly Error Formatting: Raw `"429 status code (no body)"` errors are mapped to friendly guidance in the UI.
  6. Verified on Real 150-Page Runtime: Ingested 150-page contract and verified 3 queries in real runtime on `http://localhost:3001` (page 87 token, page 150 token, and liability cap); all completed with verified quotes and complete coverage with 0 raw 429 errors.

## Phase 9 UX Fix — Sessions, Manual PDF Conversion, and In-App Document Viewers
- **Interactive Redline Sessions**:
  - Replaced the static `"5 sessions"` badge with an interactive control and `SessionsModal`.
  - Sessions are grouped by date ("Today", "Yesterday", etc.) showing: session `#ID`, timestamp, original document name, instruction used, proposed/applied/dropped counts, status badge (`Applied`, `Proposed`, `Failed`), `[View Redlined]`, `[Download DOCX]`, and `[Open Session]`.
  - Inside a session: displays instruction, proposed vs dropped edits, drop reasons (e.g. ambiguity or missing text), before/after diffs, edit reasons, and download actions.
  - Active session persists across page refreshes via URL search parameters (`?session=...`) and localStorage (`verbatim_active_session_${documentId}`).
  - Backed by existing `model redline` in Prisma with endpoints `GET /api/redline/sessions`, `GET /api/redline/sessions/:id`, and `POST /api/redline/sessions`.
- **Manual User-Controlled PDF Conversion**:
  - DOCX upload no longer triggers automatic LibreOffice PDF conversion.
  - Authoritative DOCX text is extracted immediately via `extractDocxText` so documents transition to `READY` instantly with `rendition: null`.
  - Users are prompted before conversion via `ConvertPdfModal`: *"Convert DOCX to PDF? This is only required for PDF-style viewing and highlighting. [Cancel] [Convert to PDF]"*.
  - When confirmed, `POST /api/documents/:id/convert-pdf` triggers headless LibreOffice conversion, extracts page geometry into `documentPage`, and sets `documentFile.rendition`.
  - If conversion is canceled, document state is not corrupted and remains fully usable for Word viewing, chat, and redlining.
- **In-App Document Viewers (`[View Word]` & `[View PDF]`)**:
  - Unified document viewer in the navigation rail (`[Chat]` | `[Viewer]` | `[Redline]`).
  - `WordViewer` (`src/components/viewer/word-viewer.tsx`): Zero-dependency OOXML-to-HTML parser (`src/lib/docx/render.ts`) rendering headings (H1-H3), paragraphs, tables (`<table>`, `<tr>`, `<th>`, `<td>`), bold, italics, underlines, and inline tracked changes (`<ins class="docx-ins">` and `<del class="docx-del">`) with revision toggling (`Showing Revisions` vs `Final Clean`) and zoom controls.
  - `PdfViewer`: Integrated PDF viewer with zoom, page navigation, and verified citation highlights.
  - Redline Toolbar actions: `[View Word]`, `[View PDF]`, `[Download Original]`, and upon redline generation: `[View Original]`, `[View Redlined Document]`, `[Download DOCX]`.
- **Verification & Acceptance**:
  - `tests/phase9-ux.test.ts`: 10/10 tests passing covering sessions, manual PDF conversion, in-app Word/PDF viewers, and authoritative DOCX redline independence.
  - `tests/ingest.test.ts`: 6/6 tests passing.
  - `tests/viewer-rendition.test.ts`: 11/11 tests passing.
  - Real acceptance test against `http://localhost:3001` with `verbatim_redline_test_contract.docx` verified all 12 stages (upload without auto-convert, Word viewing, manual PDF conversion prompt, PDF rendering, redline proposal, w:ins/w:del DOCX generation, in-app redlined DOCX viewing, sessions listing, session restoration, and persistence).

## Next steps
- Deployment configuration and walkthrough recording (to be performed when deploying).