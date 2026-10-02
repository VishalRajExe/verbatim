# Prompts: how to build Verbatim with an AI, phase by phase

This file is the operating manual for you (the human) and the prompts you paste into the AI coding tool (Claude Code, Cursor, Gemini CLI, anything). It sits next to `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md` and `Memory.md`.

Put the six docs plus this file in `docs/` of the new repo. The reference repos stay in `D:\ASSISMENT`, outside the repo.

---

## 1. The product in one minute (begin to end)

A reviewer uploads a contract. The app turns it into **one canonical text per document**, remembering which page and rectangle every character came from. They ask a question. The app reads **every section** of the document, asks the model only for **verbatim quotes**, and checks each quote against the canonical text **with its own code**. Only verified quotes reach the model again, which writes the answer from them. Clicking a quote draws a highlight on the real page.

| Step | What happens | Module | Why it is done this way |
| --- | --- | --- | --- |
| 1. Upload | Check extension, MIME type, magic bytes, size. Store original in MySQL. Reply 202. | `ingest/validate`, `api/documents` | Reject bad files before any work; user sees status at once. |
| 2. Process | Queue job. DOCX to PDF with LibreOffice. pdf.js reads text items with geometry. Scan check. Strip headers and footers. Build canonical text and page offsets. | `jobs/runner`, `ingest/*` | One text source for Q&A, verification and highlighting. Furniture stripping stops footers splitting a sentence across pages. |
| 3. Ask | Split text into sections of about 24k tokens. Ask the model per section for verbatim quotes (JSON). | `qa/chunker`, `qa/pipeline` | A 150-page contract fits in about 5 calls, which suits Gemini free-tier limits. |
| 4. Verify | `verifyQuote()` normalises both sides and searches the document it was attributed to. Exact only. Records every occurrence. | `verify/*`, `text/*` | The graded core: invented or paraphrased quotes can never show as Verified. |
| 5. Report coverage | Count sections read, failed, unreadable pages. | `qa/coverage` | Prevents "no such clause" after a partial read. |
| 6. Compose | Model writes the answer from verified quotes only, citing `[Q#]`. Unknown markers are filtered out while streaming. | `qa/prompts`, `qa/cite-filter` | Fluency without invention. |
| 7. Stream | Status, quotes, coverage, tokens, done as NDJSON lines. Stop aborts and saves the partial text. | `qa/ndjson-events`, route | The user always sees progress and can stop. |
| 8. Highlight | Quote's character ranges become page rectangles; viewer scrolls and highlights. | `verify/locate`, `viewer/*` | Same engine (pdf.js) extracts and renders, so coordinates line up. |
| 9. Several documents | Same pipeline per document; each quote verified against its own document. | `qa/*` | Comparison answers without cross-document leaks. |
| 10. Compare versions | Split into clauses, align, find changes, set a deterministic significance floor, AI summarises. | `compare/*` | Amount changes can never be rated low by the model. |
| 11. Redline | Model proposes minimal edits; targets verified; Adeu writes `w:ins` and `w:del`. | `redline/*` | Real tracked changes without regenerating the document. |

---

## 2. What each reference repo is for

All reference repos in `D:\ASSISMENT\` are the project owner's code. You can freely reuse, copy, and adapt logic, algorithms, prompts, components, and utilities from any of them without license restrictions or attribution notices:

| Repo & Directory | Stack | What to port / reuse | Designated Role | Used in phase |
|---|---|---|---|---|
| `legal-lens`<br>(`legal-lens-main`) | Python/FastAPI + React | Upload route layout, async background indexing pipeline, per-page text API, clause templates (`backend/services/clause_library.py`), analysis/compare prompts (`ai_features.py`), RAG prompt wording (`rag_engine.py`), Render/Railway deploy files, test suite | **Main base codebase** | All phases |
| `rag-over-pdf`<br>(`SUGGESTED-REPO/rag-over-pdf-main`) | TypeScript / Next.js | NDJSON event protocol (`lib/citations.ts`), page-by-page pdf extraction (`lib/pdf.ts`), scanned-PDF 400 handling, multi-document chunk tagging | **Pattern reference for A1, A2, B6** | 0, 1, 3, 4, 6 |
| `rag-contract-analyzer`<br>(`SUGGESTED-REPO/rag-contract-analyzer-main`) | Python/FastAPI | Refusal prompt for insufficient context, keyword risk list (`app/data/risk_terms.yaml`), two-stage ranking for change significance, test layout | **Fallback base & risk taxonomy** | 3, 7 |
| `ragadoc`<br>(`SUGGESTED-REPO/ragadoc-main`) | Python/Streamlit | Citation-to-PDF text matching and visual highlighting in PDF (PyMuPDF) | **Citation highlighting reference** | 5 |
| `react-pdf-highlighter-extended`<br>(`SUGGESTED-REPO/react-pdf-highlighter-extended-main`) | JS/TS library (PDF.js) | PDF viewer component: `PdfLoader`, `PdfHighlighter`, highlight data shape, programmatic scroll-to-highlight utility | **Frontend half of B5** | 5 (dependency) |
| `adeu`<br>(`@adeu/core` npm / repo) | Python and Node | Converts DOCX to Markdown for the LLM, then applies edits back as real `w:ins`/`w:del` tracked changes. Normalizes split runs and whitespace variations | **Part C Option 1 engine** | 8 (dependency / engine) |
| `eula-diff`<br>(`SUGGESTED-REPO/eula-diff-main`) | Go | Clause splitting, alignment, confidence level, word-level redline inside a changed clause | **Design reference for B7** | 7 |
| `compare-cli`<br>(`SUGGESTED-REPO/compare-cli-main`) | Node | Moved-clause detection (identifying identical text in different positions as MOVED rather than Added + Removed) | **Design reference for B7** | 7 |
| `contract_comparison`<br>(`SUGGESTED-REPO/contract_comparison-main`) | Full-stack | Change severity levels (Critical / High / Medium / Low) and how they are presented, report layouts | **Reference for significance ranking** | 7 |

---

## 3. Reuse policy

Short version: **All reference repositories belong to the project owner. Reuse and port logic, code, algorithms, and prompts freely from any of them.**

1. **`legal-lens` is the main base:** We build directly on it. We must strip its baggage (JWT login/multi-tenancy, MongoDB dependency, TXT uploads) and fix its critical gaps (scanned PDF detection, top-k RAG truncation on 150-page docs, missing quote verification).
2. **Port logic freely:** Adapt algorithms, prompts, or data structures from any suggested repo. Rewrite or copy as appropriate for the codebase.
3. **Bring the logic, not the baggage:** Do not carry over unnecessary multi-tenancy, auth tokens, or heavy unused services.
4. **Invariant I-4 remains non-negotiable:** Regardless of code reuse, nothing fuzzy or semantic may enter `lib/verify` or the quote verification path (Rules I-4). Verification must remain deterministic exact/normalized substring search so paraphrased or hallucinated quotes are never marked verified.
5. **Track reuse in Memory.md:** Record significant reuses under Decisions (`Reused from <file> -> <our module>`).

> `Rules.md` Rule 8 enforces this reuse policy.

---

## 4. How Memory.md works (and why it saves you)

An AI has no memory between chats. `Memory.md` is the memory. Without it, each new chat re-reads the whole codebase (slow, costly) or guesses (wrong).

- **Read order at session start:** `Memory.md`, then the current phase in `Phases.md`, then only the parts of the other docs that the task needs.
- **Write at session end:** status table, how to run, where things are, decisions with reasons, **verified library facts** (so nobody guesses an API twice), known problems, next steps.
- **Keep it true and short:** under about 150 lines, edit instead of appending, delete things once fixed.
- **README comes from it:** the "finished / not finished" section is copied from `Memory.md` and then checked in the live app.
- **Switching AI tools or opening a new chat:** use prompt S2 below.

---

## 5. Prompts used in every phase

### S0. Start of every session (paste first)

```
You are building "Verbatim", a contract-analysis web app (Next.js + MySQL + Gemini).
The repo's docs are in docs/. Follow docs/Rules.md at all times.

Read in this order and nothing more:
1. docs/Memory.md
2. docs/Phases.md, only the section for the current phase
3. Only the parts of docs/PRD.md, docs/Architecture.md and docs/Design.md that this phase touches
Do not read the whole codebase. Memory.md says where things are.

Then reply with:
- the current phase and the first three tasks you will do
- anything in Memory.md that looks stale or contradicts the code
- any question that blocks you (ask at most three)
If nothing blocks you, start the first task straight away. Work one small task at a time:
write the test, write the code, run it, then move on. Never mark anything done without running its check.
```

### R. Reuse prompt (add to a phase prompt when it names a reference repo)

```
Reference repos are my own projects, in D:\ASSISMENT (outside this repo). You may reuse their logic freely.
1. Open the exact files I name. Summarise in at most 5 lines what each does and which part you will take.
2. Copy the logic, then rewrite it in strict TypeScript in our structure: AppError, lib/env.ts, zod, our file names, tests.
   Python and Go are re-expressed, not pasted.
3. Do not copy whole folders, lockfiles, .env files, keys, or sample documents (unless confirmed synthetic).
4. Never bring fuzzy or semantic matching into lib/verify or lib/text. Verification is exact match after normalisation.
5. Add tests for what you took. Record in docs/Memory.md under Decisions: "Reused from <file> -> <our module>".
If a named file does not exist, say so and continue from the written spec. Do not invent its contents.
```

---

### S1. End of every session

```
Wrap up this session:
1. Run: type check, lint, vitest. Report exact results. Do not hide failures.
2. For the current phase, list each acceptance check from docs/Phases.md as RAN-PASS, RAN-FAIL or NOT RUN. Be honest.
3. Search the diff for secrets (AIza, sk-, "API_KEY=" with a value) and confirm .env is ignored.
4. Update docs/Memory.md (template in Rules.md section 11): status, how to run, where things are,
   decisions with reasons, verified library facts, known problems, next steps. Under about 150 lines.
5. Make small conventional commits.
6. Tell me in five lines: what works now, what does not, what is next.
```

### S2. New chat or different AI tool

```
You are joining an existing project, "Verbatim". Do not scan the repo.
Read docs/Memory.md, then the current phase in docs/Phases.md, then docs/Rules.md.
Reply with your understanding in six lines: stack, current phase, what is done, what is broken,
the invariants I-1 to I-10 in your own words, and the next task. Then wait for my go.
```

### A. Phase audit (run after each phase, ideally in a fresh chat)

```
Act as a strict reviewer, not the author. Review the changes of the phase just finished.
Check each invariant in docs/Rules.md section 2 (I-1 to I-10) against the code and name the file and line
that enforces it, or say it is not enforced. Look for: client-side verification, model-reported positions
being read, fuzzy matching, unverified quotes reaching a compose prompt, missing coverage handling,
document text in logs, API key exposure, empty catch blocks, any/@ts-ignore, missing loading/empty/error states.
Run the phase's acceptance checks that can be run. Give me a list: Must fix, Should fix, Fine. Do not edit code.
```

### D. Debug prompt template

```
Problem: <what you did, what you expected, what happened, exact error text>.
Do not change anything yet. First: list three possible causes ranked by likelihood, and for each the
smallest check that would confirm it. Run the cheapest check. Then fix only the confirmed cause, add a test
that fails without the fix, and note the lesson in docs/Memory.md under Known problems or Verified facts.
```

---

## 6. Phase prompts

Each block has: why the phase exists, what to reuse, the prompt, and how you know it worked. Paste S0 first, then the phase prompt, and finish with S1 (and A if you have the energy).

### Phase 0. Setup and spikes

**Why:** three risky unknowns can sink the project late: pdf.js inside Next.js, LibreOffice conversion, and Gemini's streaming and JSON options. A spike is a 20-minute proof that each works, so later phases do not rest on guesses.
**Reuse:** `rag-over-pdf` `lib/pdf.ts` and its Next.js route layout, for how pdf.js is called from server code.

```
Phase 0: setup and spikes. Follow docs/Phases.md Phase 0 and docs/Architecture.md sections 2, 4, 13, 16.

1. Create the Next.js app (TypeScript strict, App Router, Tailwind, npm). Add shadcn/ui, lucide-react, swr, zod,
   openai, prisma + @prisma/client, p-limit, vitest, diff. Read the installed Prisma docs before writing the
   schema, because the config syntax changed between major versions.
2. docker-compose.yml with MySQL 8 (utf8mb4). .env.example with every variable in Architecture section 13 and EMPTY secrets.
   src/lib/env.ts validates them with zod and fails fast with a readable message.
3. prisma/schema.prisma from Architecture section 4. Create the first migration. src/lib/db.ts singleton.
4. GET /api/health: reports whether the database answers and whether LLM_* are configured. Never return the key.
5. Spike A (pdf.js on the server): in a throwaway script AND inside a route handler, load a sample PDF with
   pdfjs-dist (legacy build), call getTextContent() on page 1, print the first 10 items with str, transform, width, height, hasEOL.
   If Next.js bundling fights you, move extraction to a standalone script run with child_process. Record which worked.
   Use a small synthetic PDF you generate yourself.
6. Spike B (LibreOffice): convert a synthetic DOCX to PDF with `soffice --headless --convert-to pdf` using a per-run
   -env:UserInstallation profile dir and a timeout. Record the exact working command.
7. Spike C (Gemini): with the openai package pointed at LLM_BASE_URL, run one streamed completion and one JSON-output
   completion. Find which structured-output option the endpoint accepts. Record model id and option. Do not guess;
   read Google's current docs if the first try fails.
8. Create docs/Memory.md from the template in Rules.md section 11, filled with real results.

Reuse: apply prompt R to rag-over-pdf lib/pdf.ts only for Spike A.
Out of scope: any UI beyond a placeholder page.
```

**Worked when:** `npm run dev` runs, MySQL starts, migration applies, `/api/health` is green, and three snippets are recorded in `Memory.md` under "Verified facts".

### Phase 1. Upload, processing, library

**Why:** nothing else can be tested until a document reaches READY with trustworthy text. The scanned-PDF rule, progress and restart recovery are explicit grading points.
**Reuse:** `rag-over-pdf` scanned-PDF rejection and page-by-page extraction; `legal-lens` upload route layout and background indexing flow (rewritten from Python).

```
Phase 1: upload, processing, library (PRD FR-1; Architecture section 5; Design.md sections 5.4, 5.6, 5.10, 7).

Order of work (test first for pure modules):
1. lib/ingest/validate.ts: extension, MIME, magic bytes (PDF "%PDF-", DOCX zip containing word/document.xml), size
   limit from env. Unit tests with tiny buffers: .xlsx, .txt, renamed .exe, truncated PDF, valid PDF, valid DOCX, oversize.
   Error codes and exact messages from PRD FR-1.1, 1.2, 1.8 through AppError.
2. POST /api/documents (multipart, runtime nodejs): validate, insert Document(QUEUED) + DocumentFile(original), return 202 {id}.
   Reject without storing anything when validation fails.
3. lib/jobs/runner.ts: singleton on globalThis, p-limit(1), processes QUEUED documents. src/instrumentation.ts calls
   recoverJobs() on boot: reset QUEUED/EXTRACTING/CONVERTING/INDEXING rows to QUEUED and enqueue them.
4. Ingestion pipeline: DOCX -> CONVERTING -> LibreOffice (timeout, own profile dir); EXTRACTING with pdf.js per page,
   writing stage text ("Reading page 40 of 150") and progress every few pages; scan check (tiny non-whitespace total or
   nearly all pages empty -> FAILED with errorCode NO_TEXT_LAYER, never READY); record emptyPages in warnings;
   INDEXING: strip repeated headers and footers and bare page numbers (Architecture section 5, 40% rule, digits as #),
   build page text from items (spaces and newlines from gaps and hasEOL), join pages with "\n\n", store page offsets,
   store items as top-left-origin coordinates at scale 1, store DocumentText and DocumentPage rows, set counts, READY.
   Every failure sets FAILED with errorCode and errorMessage. The row always ends in a terminal state.
5. GET /api/documents (use select; never load blobs or text), GET /api/documents/:id, DELETE (cascade).
6. UI per Design.md: library page, dropzone with inline rejection message, rows with the status pipeline and live stage text,
   "Can't read this file" failed state with Delete, warning chip for blank pages, delete confirmation dialog, empty state,
   loading placeholders, error state. SWR polling every 1.5 s only while something is unfinished.

Reuse: prompt R for rag-over-pdf (scanned-PDF handling, per-page extraction) and legal-lens (upload route and background
indexing flow; rewrite from Python in our structure).
Out of scope: OCR, chat, verification.
```

**Worked when:** every acceptance bullet in `Phases.md` Phase 1 was run: 5-page PDF, DOCX, three rejected types, scanned PDF, blank-page PDF, restart recovery, cascade delete.

### Phase 2. Canonical text and the quote verifier

**Why:** this is the most important requirement in the assignment. If verification is wrong, everything built on it is wrong. It comes before any model call so it can be proven in isolation.
**Reuse:** nothing fuzzy (Rules I-4). You may read your repos' quote-matching code for edge cases, but only exact-match ideas come in. Tests are the deliverable.

```
Phase 2: canonical text and verifyQuote (PRD FR-3; Architecture sections 6, 7, 9; Rules section 2 and 8).
No LLM calls in this phase. No UI.

Write the tests FIRST, then the code:
1. lib/text/normalize.ts and views.ts: NFKC per code point (so every output char keeps a source offset); curly quotes to
   straight; dash variants to "-"; remove soft hyphen and zero-width characters; collapse every whitespace run (incl. NBSP and
   newlines) to one space mapped to the run's first char; trim. Build the keep view, the join view (remove line-break hyphenation
   only between a letter and a lowercase letter) and the loose key (all whitespace removed), each with offset map and a final
   sentinel entry. Small in-memory LRU cache keyed by document id.
2. lib/verify/verify-quote.ts: verifyQuote(quoteText, documentId) with: min 20 / max 2000 characters; ellipsis splitting into
   segments (each >= 20), all segments must verify in order; exact search on keep then join view, all occurrences (cap 50),
   mapped to canonical [start,end) and to pageStart/pageEnd; loose key only as fallback with matchKind "loose"; otherwise NOT_FOUND;
   WRONG_DOCUMENT when the text exists only in another document; primary occurrence rule (first inside the extraction chunk,
   else first in document). There is NO parameter for model-reported positions. No fuzzy or semantic matching of any kind.
3. lib/verify/locate.ts and GET /api/documents/:id/locate: canonical ranges to rectangles per page (Architecture section 9),
   proportional slice at the first and last item, merge rectangles on the same line.
4. A debug script: load a stored document and verify a quote from the command line.
5. Fixtures (script-generated, synthetic): a PDF with a multi-line clause, a hyphenated line break, curly quotes, a page break
   with a repeating footer, and a repeated sentence; plus a second small document for the wrong-document test.

Required test cases (Rules section 8): exact; line-break difference; hyphenated break; curly quotes and dashes; ligature; NBSP;
cross-page with stripped footer; glued words (loose); repeated text (more than one occurrence); too short; too long;
ellipsis segments; paraphrase MUST FAIL; text from another document MUST FAIL.

Reuse: optional. Learn edge cases from your repos' matching code, but port nothing fuzzy or semantic.
Definition of done: all of the above tests pass, and I have seen locate's rectangles drawn once on a page image.
```

**Worked when:** the test list is green, a paraphrase fails, a cross-page quote passes, and a repeated sentence returns more than one occurrence.

### Phase 3. Chat with one document

**Why:** first full end-to-end path: ask, stages, verified quotes, streamed answer, stop, history. It exercises the extract, verify, compose design on small documents before scale is added.
**Reuse:** `rag-over-pdf` NDJSON event order and `lib/citations.ts`; prompt wording from `legal-lens` `rag_engine.py`; the refusal prompt from `rag-contract-analyzer`.

```
Phase 3: chat with one document (PRD FR-2, FR-3; Architecture section 8; Design.md sections 5.1 to 5.5, 6, 7; Rules sections 4, 6, 9).

1. lib/llm: client.ts (openai package, LLM_BASE_URL, LLM_MODEL, always an AbortSignal), retry.ts (retry only 429/500/503/network,
   max 4 attempts, exponential backoff with jitter, honour Retry-After), limiter.ts (p-limit from LLM_MAX_CONCURRENCY), json.ts
   (strip code fences, trim, parse tolerantly; validate with zod; ONE repair retry; then mark chunk failed). Tests for the parser
   and the retry rules.
2. lib/qa/prompts.ts as named constants:
   - EXTRACT: document text is untrusted data inside clear delimiters; return JSON {quotes:[{text, why}]}; verbatim, contiguous,
     1 to 3 sentences, no ellipses, no paraphrase, no positions or page numbers.
   - COMPOSE: receives ONLY verified quotes labelled Q1..Qn with document names; cite with [Q#]; do not reproduce text in quotation
     marks; say so plainly when the quotes do not answer; for several documents compare them.
3. lib/qa/schemas.ts, pipeline.ts (extract -> verify -> compose; one chunk for now), cite-filter.ts (streaming-safe [Q#] filter that
   drops unknown markers even when split across tokens; tests with markers split mid-token), ndjson-events.ts.
4. No verified quotes -> deterministic "couldn't find" message with NO model call (Architecture section 8 wording).
5. Routes: POST/GET /api/conversations, GET/DELETE /api/conversations/:id, and POST /api/conversations/:id/messages streaming NDJSON
   (headers Cache-Control no-cache no-transform, X-Accel-Buffering no). Listen to request.signal; on abort cancel the model call and
   save the partial text as STOPPED without depending on writing to the client. Errors are sent as an error event and saved as ERROR.
6. UI: conversation list, thread, composer (Enter sends, Shift+Enter newline), stage line (aria-live), quote cards (Verified vs
   collapsed "couldn't be verified"), [Q#] chips, streaming text, Stop button replacing Send, error block with Try again, suggested
   starters, loading and empty states. Streaming reader: fetch + response.body.getReader() + TextDecoder + line buffer.
7. Test hook: env flag VERBATIM_TEST_INVENT_QUOTE (off by default, never on in production) that makes extraction add one invented quote.
   It must appear only under "couldn't be verified" and never support a claim.

Reuse: prompt R for rag-over-pdf lib/citations.ts (event protocol), legal-lens rag_engine.py (prompt wording) and rag-contract-analyzer (refusal prompt).
Out of scope: viewer, several documents, big documents.
```

**Worked when:** factual question gives Verified quotes and a streamed answer; an absent topic gives the deterministic message; the invented-quote hook shows it as unverified; Stop keeps text after reload; forced 429 recovers via Try again.

### Phase 4. Large documents and coverage

**Why:** the assignment calls false absence "the worst possible output". Coverage tracking makes that impossible by construction, and a 150-page file proves the app is not sample-only.
**Reuse:** `rag-over-pdf` chunk tagging, and any chunking logic in `legal-lens`. Coverage tracking is new.

```
Phase 4: large documents and coverage (PRD FR-4; Architecture section 8; Design.md 5.3).

1. lib/qa/chunker.ts: about CHUNK_TOKENS (24000) per chunk, split on paragraph or heading boundaries, small overlap, token estimate
   from characters. Tests: no chunk exceeds the budget; no text lost; overlap deduplicated by canonical range; short documents give one chunk.
2. Extract step over ALL chunks with LLM_MAX_CONCURRENCY. A failed chunk is recorded in coverage.failedChunks and does not abort the answer.
   Emit "Reading section i of N" status events.
3. lib/qa/coverage.ts: the per-document coverage object from Architecture section 8. complete is true only if no chunk failed.
   unreadablePages > 0 adds a caveat. The deterministic not-found text AND the badge both derive from this object, so the UI cannot show
   a confident absence on a partial read.
4. Dedupe quotes found in overlapping chunks by canonical range.
5. Coverage badge component in all three states from Design.md 5.3.
6. Test hook (off in production) that forces one chunk to fail.

Reuse: prompt R for rag-over-pdf (how chunks carry a document id). Everything else is original.
Definition of done: a generated 150-page PDF reaches READY and an answer completes in about 90 seconds; badge says "Read all N sections";
with one chunk forced to fail, an absent topic yields "couldn't find it in the sections I could read", never "does not exist";
a burst of 5 questions does not crash the server.
```

### Phase 5. Viewer and citation highlighting

**Why:** a graded Part B feature and the hardest visual one: multi-line, cross-page and repeated quotes. Because the same pdf.js produced the geometry, the rectangles line up with the rendered page.
**Reuse:** the viewer library's own example app, and the citation-matching and highlight logic from `ragadoc`, rewritten to use our stored pdf.js geometry instead of PyMuPDF.

```
Phase 5: viewer and citation highlighting (PRD FR-5; Architecture section 9; Design.md 5.9, 6; Rules section 3 and I-1).

1. GET /api/documents/:id/rendition returns the PDF (the converted PDF for DOCX documents). Consider HTTP Range support.
2. BEFORE writing the viewer: read node_modules/react-pdf-highlighter-extended types and its example app. Write the exact highlight
   type, the scroll-to utility, and how a highlight spanning two pages is represented into docs/Memory.md under Verified facts.
   Do not guess these APIs. If cross-page highlights need one highlight per page, create linked highlights and scroll to the first.
3. Viewer component (client): header with document name, "Page n of N", zoom, Close; sheet layout per Design.md section 4.
4. Open-quote flow: quote card click -> GET locate for the quote's ranges -> build highlights -> open viewer -> scroll -> a single short
   pulse (disabled under prefers-reduced-motion).
5. Multi-line = several rectangles. Cross-page = highlights on both pages, header says "Passage continues on page N".
6. Repeated text: "Appears N times, showing 1 of N" with previous and next buttons that re-run locate for the chosen occurrence.
7. Active quote card state. Keyboard: cards focusable, Enter opens, Esc closes the viewer.
8. Loading and error states for the viewer.

Reuse: prompt R for react-pdf-highlighter-extended's example app and ragadoc's highlight logic (we use stored pdf.js geometry).
Honest limit to keep in docs: highlight edges can be off by a few characters because positions inside a text item are interpolated.
Definition of done: single-line, multi-line, cross-page and repeated quotes each highlight the right words on a real contract and on a
DOCX-originated document; opening a past answer's quote after reload works.
```

### Phase 6. Multi-document questions

**Why:** graded Part B. The pipeline already works per document, so this phase is mostly attribution: each quote keeps its own document id and is verified against only that document (Rules I-7).
**Reuse:** `rag-over-pdf` document id on every chunk.

```
Phase 6: multi-document questions (PRD FR-6; Architecture section 8; Design.md 5.1, 5.3; Rules I-7).

1. Library multi-select with an "Ask across documents" action (2 to MAX_DOCS_PER_QUESTION, only READY documents). Route /ask.
   Conversations with kind "multi" and ConversationDocument rows; the conversation appears in each included document's history.
2. Extract per document with its own chunks and coverage. Every returned quote carries the attributed document id.
   verifyQuote receives that document id only.
3. Compose prompt for comparison: where the documents agree, where they differ, what is missing from which one. Quotes are labelled
   with document names.
4. UI: document name on every quote card, one coverage badge per document, clicking a quote opens that document's viewer.
5. Test (must exist before the route): a quote attributed to A but present only in B fails with WRONG_DOCUMENT.

Reuse: prompt R for rag-over-pdf (document tagging).
Definition of done: "How do these two agreements handle termination?" gives a comparative answer with correct document names and chips,
and quotes open the right document.
```

### Phase 7. Document comparison

**Why:** graded Part B. The assignment's own example (AED 100,000 to AED 1,000,000 versus a reworded sentence) is the test: a deterministic rule sets the floor, so the model can raise significance but never lower it.
**Reuse:** `eula-diff` (clause splitting, alignment, confidence, word-level redline), `compare-cli` (moved-clause detection), `contract_comparison` (severity levels, report layout), `legal-lens` (clause templates, compare prompt), `rag-contract-analyzer` (`risk_terms.yaml` keywords).

```
Phase 7: document comparison (PRD FR-7; Architecture section 10; Design.md 5.7, 7; Rules section 8).

Tests first, using a fixture pair you generate: AED 100,000 -> AED 1,000,000 (expect High), a pure rewording (Low or Cosmetic),
a moved clause (Moved, not Added plus Removed), an added clause, a removed clause.
1. lib/compare/clauses.ts: split canonical text into units using numbering patterns (1. / 1.1 / (a) / Article / Section) and blank-line
   structure. Each unit: number?, heading?, text, start, end. If splitting looks unreliable, lower a confidence value and say so in the UI.
2. align.ts: identical after aggressive normalisation -> UNCHANGED (or MOVED when order differs); same number or heading with
   similarity >= 0.5 -> MODIFIED; remaining pairs by bigram-Dice >= 0.6 -> MODIFIED; leftovers -> REMOVED or ADDED;
   equal after stripping case, punctuation and numbering -> COSMETIC. Write the Dice code yourself. This is alignment, NOT quote
   verification, so the no-fuzzy rule of lib/verify does not apply here.
3. materiality.ts: extract money (currency + amount), numbers with units (days, months, years), percentages, dates, modal words
   (shall, must, may, will, shall not), negations, "unlimited", jurisdictions. Any changed token gives at least MEDIUM; an amount
   change of 2x or more, or direction change in liability / payment / termination / indemnity / governing-law gives HIGH.
4. categories.ts: keyword map by clause category (liability, payment, termination, indemnity, confidentiality, governing law, ...).
   Seed from legal-lens clause templates and rag-contract-analyzer's risk_terms.yaml.
5. AI pass in batches of about 15 changes: input is category hint + old text + new text (untrusted data); output {id, significance,
   title, summary}. The model may raise significance above the floor, never lower it. A failed batch falls back to an automatic
   summary built from the token diff ("Amount changed from AED 100,000 to AED 1,000,000"), labelled summarySource "automatic".
   Overall summary from the top changes, or automatic if the call fails.
6. Persist Comparison and ComparisonChange with aStart/aEnd/bStart/bEnd. POST /api/comparisons, GET /api/comparisons/:id with
   filter and sort query params. Restart recovery for comparisons in QUEUED or RUNNING.
7. UI: picker (READY documents only), progress stages, overall summary, change list with significance tags, filters (significance,
   type, category), sort (significance, document order), word-level inline diff inside modified clauses using the `diff` package for
   display only, "Open in documents" using locate for both versions. Unchanged clauses are counted, not listed.

Reuse: prompt R for legal-lens (clause templates, compare prompt), eula-diff (alignment, confidence), compare-cli (moved
clauses), contract_comparison (severity). Port the logic into TypeScript.
Definition of done: fixture pair gives the expected counts and significance; High filter shows only High; forcing the AI call to fail
still shows automatic summaries; a 150-page pair completes.
```

### Phase 8. Redlining (Part C, Option 1)

**Why:** the assignment's hardest option. Text is split across formatting runs, so string replacement fails and regenerate-and-diff produces spurious changes. Adeu's engine handles the XML; our job is correct edits, verification, preview, validation and honest reporting.
**Reuse:** `@adeu/core` from npm as a dependency. If the package does not work, copy the needed logic from your own `adeu` repo.

```
Phase 8: redlining with tracked changes (PRD FR-8; Architecture section 11).

1. SPIKE FIRST (30 to 45 minutes, before any UI): read @adeu/core's README and type definitions. With a synthetic DOCX that has bold text,
   a numbered list and a table, apply ONE edit, save it, and open the result in LibreOffice (and Word if available). Confirm it shows as a
   revision. Record the working API in docs/Memory.md under Verified facts. If the TypeScript SDK does not work, switch to the Python
   adeu CLI through child_process, add Python to the Dockerfile, and record the decision.
2. lib/redline/view.ts: the text view of the DOCX that edits must match (from Adeu, not the PDF text).
3. propose.ts: scan chunks of that view for passages relevant to the instruction, verify them with the same verifier on this view (I-10),
   then ask for minimal edits [{target, replacement, reason}] where target is an exact substring of a verified passage and only the
   words that must change are changed.
4. verify-edits.ts (tests first): each target must occur exactly once in the view; more than once -> request more context or drop and
   report; not found -> drop and report.
5. apply.ts and validate-docx.ts: apply included edits with the engine under author REDLINE_AUTHOR; unzip and count w:ins / w:del;
   confirm untouched paragraphs have identical XML to the original; convert with LibreOffice headless as an "opens cleanly" smoke test.
6. Routes: POST /api/redlines (propose), POST /api/redlines/:id/apply, GET /api/redlines/:id/download.
7. UI per Design.md 5.8: instruction box only on DOCX documents (PDFs show why it is unavailable), edit list with before/after and an
   include checkbox each, "Edits we couldn't apply" list, download button. Instruction for text that does not exist reports that
   clearly and produces no file.

Reuse: npm dependency first; your adeu repo's source as the fallback.
Definition of done: "Make the liability cap mutual" changes only the affected clause; a two-part instruction produces two or more
revisions in one pass; open in Word or LibreOffice, accept one revision, reject another; XML of an untouched paragraph is identical.
Write down honestly what did not work (text boxes, fields, existing tracked changes, if untested).
```

### Phase 9. Polish, deploy, README, video, note

**Why:** evaluators use the deployed link first. They also penalise claims that are untrue, so documentation is derived from `Memory.md` and checked against the live app.
**Reuse:** `legal-lens` CI workflow and deploy files (adapt for Node and Railway).

```
Phase 9: polish, deploy, README, note (PRD FR-9; Phases.md Phase 9; Design.md sections 7 to 9).

1. State audit, per screen: loading, empty, error, partial or warning, success. List gaps in a table, then fix them.
2. Accessibility pass using Design.md section 8: tab through upload -> ask -> open quote -> compare; visible focus; contrast of every colour
   pair in Design.md (fix by changing the token in globals.css, not in components); reduced motion.
3. Copy pass against Design.md section 9 and the fixed strings table.
4. Dockerfile (Node LTS slim, LibreOffice Writer, fonts-liberation, fonts-dejavu-core, Next standalone output, prisma migrate deploy on start),
   docker-compose for local, health check. Deploy to a long-running host with managed MySQL (not serverless). Verify upload, DOCX conversion
   and streaming on the DEPLOYED URL, with response buffering disabled and timeouts high enough for streams.
5. Run the full demo script from PRD section 9 on the deployed app with a 150-page document. Fix whatever breaks.
6. README: what it does, screenshots (upload, chat with verified quotes, citation highlighting, comparison, redline), local run, environment
   variables, what is finished and what is not (copied from docs/Memory.md and then checked in the live app), known limits.
7. docs/NOTE.md (half a page): how verification works and where it can fail (Architecture section 7), how large documents are handled,
   Part C choice, how far it got and the hardest part, what is next.
8. Final secret check across the working tree AND git history for the API key; confirm .env is ignored.
Do not claim anything works that you have not exercised on the deployed app.
```

**Worked when:** a stranger can open the link, upload their own contract and complete the demo script without help.

---

## 7. Practical order for three days

| Day | Phases | Safety rule |
| --- | --- | --- |
| 1 | 0, 1, 2, 3 | Deploy a first working version at the end of the day |
| 2 | 4, 5, 6, 7 | Redeploy after each phase |
| 3 | 8, then 9 | Record the video last, after the deployed app is verified |

If time runs short, use the cut list in `Phases.md`. Never cut verification, coverage honesty, highlighting, a working deployed link, or an honest README.

## 8. Rules of thumb when working with the AI

1. One phase per chat, or at least one phase per session. Finish with S1 every time.
2. If the AI says "done" without listing which checks it ran, paste: "List each acceptance check as RAN-PASS, RAN-FAIL or NOT RUN."
3. If it proposes a new dependency, a schema change or a route rename, make it explain in two sentences first (Rules section 1, rule 3).
4. If it starts adding features not in the PRD, say: "Out of scope for this phase. Note it in Memory.md under Ideas and continue."
5. When something fails twice, stop and use prompt D instead of letting it try random fixes.
6. Keep real contracts out of the repo and out of fixtures.
