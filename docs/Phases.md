# Phases

The AI builds **one phase at a time**. Do not start a phase until the previous one's acceptance checks pass. FR numbers refer to `PRD.md`; section numbers refer to `Architecture.md`.

Phases are ordered by what the evaluators grade first: a working deployed app, then verified quotes, then the advanced features. Time estimates assume a focused three-day push and are rough.

| Phase | Name | Est. | Needs |
|---|---|---|---|
| 0 | Setup and spikes | 2 h | none |
| 1 | Upload, processing, library | 4 h | 0 |
| 2 | Canonical text and the quote verifier | 4 h | 1 |
| 3 | Chat with one document (streaming, stop, history) | 5 h | 2 |
| 4 | Large documents and coverage | 3 h | 3 |
| 5 | Viewer and citation highlighting | 5 h | 2, 3 |
| 6 | Multi-document questions | 2 h | 4, 5 |
| 7 | Document comparison | 6 h | 2, 5 |
| 8 | Redlining (Part C, Option 1) | 5 h | 1, 2 |
| 9 | Polish, deploy, README, video, note | 6 h | all |

Suggested pacing: **Day 1** = phases 0 to 3. **Day 2** = phases 4 to 7. **Day 3** = phase 8, then 9. Deploy a first working version at the end of Day 1 and redeploy after every phase so there is never a big-bang deploy.

---

## Phase 0: Setup and spikes

**Goal:** an empty app that runs, and proof that the risky libraries work.

Tasks
1. `create-next-app` (TypeScript, App Router, Tailwind). Add shadcn/ui, `lucide-react`, `swr`, `zod`, `openai`, `prisma`, `p-limit`, `vitest`, `diff`.
2. `docker-compose.yml` with MySQL 8 for local development. `.env.example` with every variable from `Architecture.md` section 13. `lib/env.ts` validating them.
3. Prisma schema from `Architecture.md` section 4; first migration; `lib/db.ts`.
4. `GET /api/health` returning database and LLM configuration status (never the key).
5. **Spike A, pdf.js on the server:** extract text items and positions from a sample PDF inside a Next.js route handler or script. If bundling fights back, move extraction to a standalone script run with `child_process`. Record the outcome.
6. **Spike B, LibreOffice:** convert a sample DOCX to PDF locally with `soffice --headless`. Record the exact command that works.
7. **Spike C, Gemini:** one streamed completion and one JSON-output completion through the OpenAI client using `LLM_BASE_URL`. Record the structured-output option that works and the model id.
8. Create `docs/Memory.md` from the template in `Rules.md` section 11.

Acceptance
- `npm run dev` serves the app; `docker compose up` brings up MySQL; migration applies.
- The three spikes each have a working snippet and a line in `Memory.md` under "Verified facts".

Out of scope: any UI beyond a placeholder page.

---

## Phase 1: Upload, processing, library (FR-1)

**Goal:** a document can be uploaded, processed with visible progress, listed, opened and deleted.

Tasks
1. `lib/ingest/validate.ts`: extension, MIME, magic bytes, size. Unit tests with tiny buffers.
2. `POST /api/documents` (multipart): validate, store `Document` + `DocumentFile`, return 202.
3. `lib/jobs/runner.ts` and `src/instrumentation.ts`: in-process queue, recovery on boot (FR-1.7).
4. Ingestion pipeline (`Architecture.md` section 5): convert DOCX, extract with pdf.js, write progress, scan check, strip page furniture, build page text and items, store canonical text and pages. Statuses and stage strings as specified.
5. `GET /api/documents`, `GET /api/documents/:id`, `DELETE /api/documents/:id` (cascade).
6. UI: library page with dropzone, list rows, status pipeline with progress, failed state with reason, delete confirmation, empty state. Poll with SWR every 1.5 s while any document is unfinished.
7. Rejection messages exactly as in PRD FR-1.1, 1.2, 1.4, 1.8.

Acceptance (run all)
- Upload a 5-page PDF: status moves through stages and ends READY; reload mid-way and the progress is still shown.
- Upload a `.docx`: converts and becomes READY.
- Upload `.xlsx`, `.txt`, and a renamed `.exe`: each refused with the message; nothing stored.
- Upload an image-only (scanned) PDF: ends as "Can't read this file" with the reason and a Delete button; cannot be opened.
- Upload a PDF with one blank page: READY with the warning.
- Stop the server during processing, restart: the document finishes.
- Delete removes rows in all tables (check in MySQL).

Out of scope: OCR, chat.

---

## Phase 2: Canonical text and the quote verifier (FR-3)

**Goal:** a tested `verifyQuote()` that is the foundation of everything else. No LLM yet.

Tasks
1. `lib/text/normalize.ts` and `views.ts`: normalisation with offset maps, keep and join views, loose key, LRU cache (`Architecture.md` section 6).
2. `lib/verify/verify-quote.ts` with min/max length, ellipsis splitting, occurrences (cap 50), page ranges, primary occurrence rule, wrong-document rule (`Architecture.md` section 7).
3. `lib/verify/locate.ts`: char ranges → rectangles per page (`Architecture.md` section 9). `GET /api/documents/:id/locate`.
4. A debug-only script or test helper that loads a stored document and verifies a quote from the command line.
5. Test fixtures: a small synthetic PDF with a multi-line clause, a hyphenated line break, curly quotes, a page break with a footer, and a repeated sentence.

Acceptance
- Every case listed in `Rules.md` section 8 has a passing test.
- Paraphrased quote fails; quote from the other document fails; quote across the page break passes; repeated sentence returns more than one occurrence.
- `locate` returns plausible rectangles for a known sentence (check by drawing them on the page image once, by hand).

Out of scope: UI, model calls.

---

## Phase 3: Chat with one document (FR-2, FR-3)

**Goal:** ask a question, watch stages, see verified quotes, read a streamed answer, stop it, reopen history.

Tasks
1. `lib/llm/` client, retry, limiter, tolerant JSON parser, with tests for the parser and retry rules.
2. `lib/qa/`: `chunker.ts` (one chunk for short documents for now), `prompts.ts`, `schemas.ts`, `pipeline.ts` implementing extract → verify → compose, `cite-filter.ts` (streaming-safe `[Q#]` filter, with tests splitting markers across tokens), `ndjson-events.ts`.
3. Deterministic "not found" message path (no model call).
4. `POST /api/conversations`, `GET /api/conversations?documentId=`, `GET /api/conversations/:id`, `DELETE`, and the streaming `POST /api/conversations/:id/messages` (headers, abort handling, save partial on stop).
5. UI: conversation list for the document, thread, composer, stage line, quote cards (verified vs "couldn't be verified" collapsed), streaming text with `[Q#]` chips, Stop button, error state with "Try again".
6. Persist `Message` and `Quote` rows; reload restores the thread.

Acceptance
- Ask a factual question on a small contract: stages appear, quotes show as Verified, answer streams with chips.
- Ask about something absent: deterministic "couldn't find" message, no quotes, no invented content.
- Use a test hook (env flag, off in production) that makes the extract step return one invented quote: it appears only under "couldn't be verified" and the answer does not rely on it.
- Press Stop mid-answer: text stays, marked Stopped; reload: still there.
- Disconnect the network / force a 429: error is explained and "Try again" works.
- Start two conversations on the same document; both appear in history; delete one.

Out of scope: viewer, multi-document, big documents.

---

## Phase 4: Large documents and coverage (FR-4)

**Goal:** a 150-page contract works and the app never overclaims.

Tasks
1. Full `chunker.ts`: ~`CHUNK_TOKENS` per chunk, split on paragraph or heading boundaries, small overlap, tests (no chunk exceeds the budget, no text lost, overlap deduped by canonical range).
2. Extract step over all chunks with `LLM_MAX_CONCURRENCY`, per-chunk failure handling, progress events "Reading section i of N".
3. `coverage.ts` and the coverage badge UI; deterministic caveat text for partial coverage and for unreadable pages.
4. Dedupe quotes found in overlapping chunks.
5. Test hook to fail a chosen chunk.

Acceptance
- A generated or real ~150-page PDF becomes READY and an answer completes in under about 90 s.
- Coverage badge reads "Read all N sections".
- With one chunk forced to fail: badge shows partial coverage, and asking about something absent produces "couldn't find it in the sections I could read", never "does not exist".
- A rapid burst of 5 questions does not crash the server (some may take longer; none produce a wrong confident absence).

---

## Phase 5: Viewer and citation highlighting (FR-5)

**Goal:** clicking a verified quote scrolls to and highlights the exact passage.

Tasks
1. `GET /api/documents/:id/rendition` (PDF for PDF and DOCX documents; consider Range support).
2. Viewer component wrapping `react-pdf-highlighter-extended`. Read the library's types and example app first; record the highlight shape and scroll utility in `Memory.md`.
3. Open-quote flow: quote card click → `locate` → build highlight(s) → open viewer pane → scroll → single short pulse (disabled for reduced motion).
4. Multi-line: several rectangles. Cross-page: highlights on both pages, scroll to the first.
5. Repeated text: "Appears N times, showing 1 of N" with previous / next that re-locate.
6. Viewer chrome per `Design.md`: close, page indicator, zoom.

Acceptance (visual, with a real contract)
- Single-line, multi-line, cross-page and repeated quotes each highlight the right words; the edges are within a few characters.
- Works for a DOCX-originated document.
- Works after reload (opening a past answer's quote).
- Keyboard: quote cards are focusable and open the viewer with Enter.

---

## Phase 6: Multi-document questions (FR-6)

**Goal:** one question over 2 to 5 documents, a comparative answer, per-document verification.

Tasks
1. Library multi-select and "Ask across documents" entry; `kind = "multi"` conversations with `ConversationDocument` rows.
2. Extract step runs per document with its own chunks and coverage; quotes keep their document id.
3. Compose prompt for comparison (agree / differ / missing), with document names on quotes.
4. UI: document name tag on each quote, one coverage badge per document, history visible under each included document.
5. Tests: quote attributed to A but present only in B fails verification.

Acceptance
- Ask "How do these two agreements handle termination?" on two contracts: the answer states similarities and differences with `[Q#]` chips; quotes show the right document names; clicking a quote opens the right document.
- Conversation appears in both documents' histories.

---

## Phase 7: Document comparison (FR-7)

**Goal:** two versions in, ranked meaningful changes out.

Tasks
1. `lib/compare/clauses.ts`, `align.ts` with tests on the fixture pair (added, removed, modified, moved, cosmetic).
2. `materiality.ts`: token extraction (money, numbers with units, percentages, dates, modal words, negations) and the floor rules, with tests (AED 100,000 → AED 1,000,000 is High).
3. `categories.ts`: keyword map seeded from the reference repos' clause templates and risk terms.
4. AI pass in batches with automatic fallback summaries; overall summary.
5. `POST /api/comparisons`, `GET /api/comparisons/:id` with filter and sort query params; recovery on restart.
6. UI: picker, progress, overall summary, change list with significance, type and category filters, sort, inline word-level redline for modified clauses, "Open in documents" using `locate` for both versions.

Acceptance
- Fixture pair produces the expected counts and significance, including the amount change as High and the reworded sentence as Low or Cosmetic.
- Filtering by High shows only High; sorting works.
- Failing the AI call still shows automatic summaries labelled "automatic".
- 150-page pair completes (slow is acceptable; stuck is not).

---

## Phase 8: Redlining, Part C Option 1 (FR-8)

**Goal:** a plain-language instruction becomes real tracked changes in the DOCX.

Tasks
1. **Spike first (30 to 45 min):** with `@adeu/core`, apply one edit to a sample DOCX, save it, open it in LibreOffice (and Word if available), confirm it shows as a revision. Record the working API in `Memory.md`. If the TypeScript SDK does not work, switch to the Python `adeu` CLI via child process and add Python to the Docker image; record the decision.
2. `lib/redline/view.ts`: get the text view of the DOCX that edits must match.
3. `propose.ts`: locate relevant passages by scanning chunks (verified with the same verifier), then request minimal edits.
4. `verify-edits.ts`: each target must occur exactly once in the view; otherwise drop or ask for more context; report dropped edits.
5. `apply.ts` and `validate-docx.ts`: apply included edits, count `w:ins` / `w:del`, confirm untouched paragraphs are byte-identical in XML, LibreOffice conversion smoke test.
6. Routes: propose, apply, download.
7. UI: instruction box on DOCX documents, edit list with before/after and include checkboxes, download button, honest notes for dropped edits.

Acceptance
- "Make the liability cap mutual" produces tracked changes only in the affected clause; open in Word or LibreOffice and accept one revision and reject another.
- A two-part instruction produces edits in two places in one pass.
- Fonts, bold, numbering and tables elsewhere are unchanged (diff the XML of an untouched paragraph).
- An instruction for text that does not exist reports that clearly and produces no file.

Document honestly in the README what did not work (for example documents with text boxes, fields or existing tracked changes, if untested).

---

## Phase 9: Polish, deploy, README, video, note

**Goal:** the deployed app is the real thing, and the submission explains it.

Tasks
1. **State audit** against this checklist, per screen: loading, empty, error, partial/warning, success. Fix gaps.
2. Accessibility pass: keyboard through upload → ask → open quote → compare; contrast; focus rings; reduced motion.
3. Copy pass using `Design.md` writing rules (verbs on buttons, errors say what to do).
4. Dockerfile and deployment (Railway or similar), `prisma migrate deploy` on start, environment variables set on the host, health check. Verify upload, DOCX conversion and streaming **on the deployed URL**, not just locally.
5. Run the full demo script from `PRD.md` section 9 on the deployed app with a 150-page document. Fix what breaks.
6. README: what it does, screenshots (upload, chat with verified quotes, citation highlighting, comparison, redline), run locally, environment variables, what is finished and what is not (copied from `Memory.md`, checked against the app), known limits.
7. Half-page note (`docs/NOTE.md`): how verification works and where it fails (`Architecture.md` section 7), how large documents are handled, Part C choice and the hardest part, what is next.
8. Record the 3 to 5 minute video following the demo script, including what does not work.
9. Final secret check: search the repository and history for the API key; confirm `.env` is ignored.

Acceptance
- A stranger can open the deployed link, upload their own contract and complete the demo script without help.
- README claims match reality; every "finished" item was exercised on the deployed app.

---

## Cut list (if time runs out, drop in this order)

1. Dark theme, animations beyond the single highlight pulse (not planned anyway).
2. Redline preview niceties (keep: propose → include/exclude → download).
3. Comparison filters by category (keep significance filter and sort).
4. Per-document history display inside multi-document conversations (keep one history list).
5. Word-level inline redline in the comparison (keep clause-level old/new text).

**Never cut:** verification (Phase 2), coverage honesty (Phase 4), highlighting (Phase 5), a working deployed link, an honest README.

## Optional extras (only after Phase 9 is complete)

- Clause finder using the clause templates (cheap once categories exist).
- Re-run recovery test for comparisons.
- Anything else from the assignment's extras list, only if everything above works.
