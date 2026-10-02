# PRD: Verbatim

**Working name:** Verbatim. A contract analysis web app where every answer is backed by quotes the code has proven exist in the document.
**Stack in one line:** Next.js (App Router, TypeScript) + MySQL (Prisma) + Gemini (via its OpenAI-compatible endpoint) + pdf.js + LibreOffice + Adeu.
**Status:** Planning. Read `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md` next.

---

## 1. Summary

A single user uploads a legal contract (PDF or DOCX) and asks questions about it in a chat. The app answers using **only** what is in the document. Each answer carries quotes copied from the document. **Before a quote is shown, our own code confirms it exists in the document text.** Clicking a verified quote opens the document, scrolls to the passage and highlights it.

Beyond Q&A the app can:

- answer one question across several contracts and compare them,
- compare two versions of a contract and rank the changes by significance,
- turn a plain-language instruction ("make the liability cap mutual") into real Word tracked changes (Part C, Option 1).

## 2. Problem

People who review contracts cannot trust a chatbot that sounds confident. Two failures are unacceptable:

1. **Invented or paraphrased quotes** presented as if they were in the contract.
2. **False absence**: saying "there is no termination clause" after reading only part of a long document.

Everything in this product exists to make those two failures impossible or, where impossible is not achievable, loudly visible.

## 3. Users

| User | Situation | What they need |
|---|---|---|
| **Contract reviewer** (in-house counsel, paralegal, legal ops) | Has a 20 to 150 page contract and one specific question | A fast answer with proof they can click and read in context |
| **Deal / procurement analyst** | Holds two to five vendor contracts, or two drafts of one | A comparison, not separate summaries; changes ranked by what matters |
| **Negotiator** | Wants to change a clause | Edits delivered as tracked changes they can accept or reject in Word |

There is **one user and no login**. Documents are not shared.

## 4. Principles

1. **Proof over fluency.** A shorter answer with verified quotes beats a smooth answer without them.
2. **Never overclaim coverage.** If the app read only part of a document, it says so on the answer itself.
3. **Never leave the user guessing.** Every wait has a visible state; every failure says what happened and what to do.
4. **Fewer features that really work.** An unfinished feature is hidden or labelled, never faked.
5. **Plain language.** Interface copy is written for the reviewer, not the developer.

## 5. Scope

### In scope (graded)
Part A (upload, chat, verified quotes, large documents), Part B (citation highlighting, multi-document questions, document comparison), Part C Option 1 (tracked-change redlining), README, screenshots, demo video, half-page note.

### Out of scope for v1
Login or accounts, multi-user sharing, OCR for scanned PDFs (we detect and report them), Arabic / right-to-left layout, voice input, anonymisation, semantic search with embeddings, PDF/Word export of answers, mobile-first layout, dark theme.

### Optional extras (only after everything else works)
Clause extraction using clause templates, background-job recovery (cheap in this design; see FR-1.7).

## 6. Functional requirements

IDs are referenced from `Phases.md`. "Accept" is the test a reviewer can run.

### FR-1 Upload and processing

| ID | Requirement | Accept when |
|---|---|---|
| 1.1 | Accept PDF and DOCX only. Check extension, MIME type and file signature (magic bytes). | Uploading `.xlsx`, `.txt`, or a renamed `.exe` is refused with: "Only PDF and DOCX files are supported." and nothing is stored. |
| 1.2 | Maximum upload size (default 25 MB, env-configurable). | A larger file is refused with a message that states the limit. |
| 1.3 | Visible processing status: queued, converting (DOCX), reading pages with progress, preparing, ready. | Status text and a progress bar update at least every 2 seconds, survive a page reload, and never sit unchanged without an explanation. |
| 1.4 | A scanned PDF with no selectable text is **not** saved as a success. | The document appears as "Can't read this file" with the reason ("no selectable text; OCR is not supported") and a Delete button. It cannot be opened for chat. |
| 1.5 | A PDF with some empty pages is accepted with a warning. | Library shows "N pages had no text and are not searchable". Answers acknowledge those pages (see FR-4.3). |
| 1.6 | Document library: list, open, delete (with confirmation). | Listing shows name, type, pages, size, uploaded time, status. Delete removes the document, its conversations and its files. |
| 1.7 | Unfinished processing resumes after a server restart. | Kill the server mid-upload, restart, and the document continues to ready (or fails visibly). |
| 1.8 | Corrupt or password-protected files fail with a specific reason. | A truncated PDF shows "This file appears to be damaged." |

### FR-2 Chat with a document

| ID | Requirement | Accept when |
|---|---|---|
| 2.1 | Ask a question about a ready document and receive an answer. | Works for single-page and 150-page documents. |
| 2.2 | The answer **streams** as it is written. | Text appears progressively, not all at once. |
| 2.3 | Visible stages before the first word: "Reading section 2 of 5", "Checking quotes", "Writing answer". | The user always sees what the app is doing. |
| 2.4 | **Stop** button during generation. Whatever was written is kept. | After Stop, the partial answer remains in the thread, marked "Stopped", and survives reload. |
| 2.5 | Chat history is saved per document and can be reopened. | Reload the app, open the document, see earlier conversations; start a new one; delete one. |
| 2.6 | If the answer is not in the document, the app says so. | Asking about something absent returns a plain "not found" statement, with no invented content and no quotes. |
| 2.7 | Rate-limit or provider errors are explained and recoverable. | The thread shows what failed and a "Try again" action; no half-answer is presented as complete. |

### FR-3 Verified quotes (the most important requirement)

| ID | Requirement | Accept when |
|---|---|---|
| 3.1 | Every answer that states something about the document is backed by at least one quote. | Answers with no verified quote say they found nothing; they do not assert content. |
| 3.2 | **The server verifies each quote against the cited document's text before the client sees it as verified.** | A quote the model made up never appears with a Verified label. |
| 3.3 | Matching tolerates whitespace, line breaks, line-break hyphenation, curly vs straight quotes, dash variants, ligatures and non-breaking spaces. | A genuine quote that spans a PDF line break is verified. |
| 3.4 | Verified quotes are labelled "Verified" and open the document. Unverified quotes are never styled as verified; they are collapsed under "Couldn't be verified", have no open action, and are not used to support any claim. | Test with a deliberately paraphrased quote: it appears only as unverified. |
| 3.5 | Positions, page numbers and offsets reported by the model are ignored. The server locates every quote itself. | Prompts do not ask for positions; code never reads them. |
| 3.6 | Citation markers in the answer (for example `[Q2]`) must refer to a verified quote. Unknown markers are removed. | A model that emits `[Q9]` with no such quote shows no marker. |
| 3.7 | Quotes shorter than 20 characters or longer than 2,000 characters are not accepted as verified evidence. | Enforced in code and covered by tests. |

### FR-4 Large documents

| ID | Requirement | Accept when |
|---|---|---|
| 4.1 | A 150-page contract works. | Upload, ask, get a verified answer in under about 90 seconds on the Gemini free tier. |
| 4.2 | The whole document is read for each question by splitting it into sections processed one after another with limited parallelism. | Coverage shows every section was read. |
| 4.3 | **Coverage is shown on every answer** ("Read all 5 sections, 150 pages"). If any section failed or any page was unreadable, the answer carries a visible notice and **must not claim that something does not exist**. | Force one section to fail in a test: the answer says "could not read sections 3 of 5, so absence is not confirmed". |
| 4.4 | Provider rate limits are handled with limited concurrency, retries and backoff. | A burst of questions does not crash the app. |

### FR-5 Citation highlighting

| ID | Requirement | Accept when |
|---|---|---|
| 5.1 | Clicking a verified quote opens the document viewer, scrolls to the passage and highlights it. | Works from any answer, including after reload. |
| 5.2 | Quotes that span several lines highlight every line. | Visual check on a multi-line clause. |
| 5.3 | Quotes that cross a page break highlight the end of one page and the start of the next. | Visual check across a page boundary. |
| 5.4 | If the same text appears more than once, the viewer says so ("Appears 3 times, showing 1 of 3") and lets the user step between matches. | Test with a repeated boilerplate sentence. |
| 5.5 | DOCX documents highlight too (viewer shows the converted PDF). | Same checks on a `.docx`. |
| 5.6 | Highlight uses a single short emphasis animation; respects reduced-motion. | Manual check. |

### FR-6 Multi-document questions

| ID | Requirement | Accept when |
|---|---|---|
| 6.1 | Select 2 to 5 documents and ask one question. | Selection UI in the library and chat. |
| 6.2 | The answer **compares across documents** (where they agree, where they differ, what one lacks). It is not a list of separate answers. | Read the answer: it contains comparison statements, not "Document A says… Document B says…" only. |
| 6.3 | Every quote shows which document it came from and is **verified against that document only**. | A quote text that exists only in document B but is attributed to A is unverified. |
| 6.4 | Coverage is shown per document. | One badge per document. |
| 6.5 | The conversation appears in the history of each included document. | Check both documents' histories. |

### FR-7 Document comparison

| ID | Requirement | Accept when |
|---|---|---|
| 7.1 | Choose an older and a newer version. | Picker excludes documents that are not ready. |
| 7.2 | Differences at **clause or paragraph level**: added, removed, modified, moved. Unchanged clauses are counted, not listed. | No character-level diff view as the primary result. |
| 7.3 | Modified clauses show the exact old and new text with the changed words marked. | Visual check. |
| 7.4 | A plain-language summary of what changed **in substance**, per change and overall. | "Liability cap raised from AED 100,000 to AED 1,000,000" rather than "wording changed". |
| 7.5 | Each change has a significance: **High, Medium, Low, Cosmetic**. A deterministic rule sets a floor so numbers, amounts, durations, dates and obligation words (shall / may / must / shall not) cannot be rated low by the model. | Fixture test: AED 100,000 to AED 1,000,000 is High; a reworded sentence with the same meaning is Low or Cosmetic. |
| 7.6 | Filter by significance, type and clause category; sort by significance or document order. | Controls present and working. |
| 7.7 | Clicking a change opens both versions at that location. | Reuses the highlighting from FR-5. |
| 7.8 | Works for 150-page documents; if the AI summary fails for some changes, a deterministic summary is shown and labelled "automatic". | Force a failure and check. |

### FR-8 Tracked-change redlining (Part C, Option 1)

| ID | Requirement | Accept when |
|---|---|---|
| 8.1 | On a DOCX, the user types a change in plain language. | Input available on DOCX documents only; PDFs show why it is unavailable. |
| 8.2 | The app proposes concrete edits (existing text → replacement). Each edit's target is **verified to exist in the document** before it is offered. | An edit whose target cannot be found is dropped and reported. |
| 8.3 | The user previews edits and includes or excludes each one. | Checkbox per edit with before and after text. |
| 8.4 | The downloaded `.docx` contains real tracked changes (`w:ins` / `w:del`) that Word shows as revisions the user can accept or reject one by one. | Open in Word or LibreOffice: revisions are listed and individually acceptable. |
| 8.5 | All original formatting is preserved; only changed text is touched; no renumbering or restyling. | Compare unchanged paragraphs before and after: identical XML. |
| 8.6 | Several edits can be applied in one pass. | A two-part instruction produces two or more revisions. |
| 8.7 | Edits are minimal (change the words that need to change, not the whole clause). | Review of sample outputs. |
| 8.8 | Honest limits are documented (what failed or is untested). | README and note. |

### FR-9 Interface quality

| ID | Requirement | Accept when |
|---|---|---|
| 9.1 | Every data view has loading, empty and error states. | Checklist in `Phases.md` Phase 9. |
| 9.2 | Keyboard operable, visible focus, accessible names, sufficient contrast. | Tab through the main flows. |
| 9.3 | Responsive down to tablet width; usable (not beautiful) on phone width. | Manual check. |
| 9.4 | Copy follows `Design.md` writing rules. | Review. |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | A 20-page PDF is ready in under 20 s; a 150-page PDF in under 90 s. First status event of an answer in under 1 s. |
| Reliability | No unhandled promise rejections in server logs during the demo path. Restart-safe processing (FR-1.7). |
| Privacy | Document text and API keys are never logged. The API key is only read on the server. `.env` is never committed. |
| Honesty | The README lists only what works. Known gaps are named. |
| Portability | `docker compose up` runs the app and MySQL locally. Deployed as one container plus managed MySQL. |

## 8. Core flows

1. **Upload:** drop file → validated → queued → (convert) → reading pages n/N → ready, or failed with reason.
2. **Ask:** type question → stages shown → quotes appear (verified/unverified) → answer streams with `[Q#]` markers → coverage badge → click a quote → viewer opens at the passage.
3. **Ask across documents:** select documents → ask → comparative answer with per-document quote labels.
4. **Compare versions:** choose two documents → processing → overall summary + ranked change list → click change → side-by-side location.
5. **Redline:** choose a DOCX → type instruction → review edits → download tracked-changes file.

## 9. Demo acceptance script (becomes the demo video)

1. Upload a 150-page PDF; show progress; show a scanned PDF being refused with a clear reason; show a `.xlsx` being rejected.
2. Ask a question; show streaming, stages, Verified quotes, coverage badge "Read all N sections".
3. Ask about something not in the document; show the honest "not found".
4. Click a quote; show scroll and highlight. Click a multi-line and a cross-page quote. Click a repeated one and step between matches.
5. Show a deliberately unverifiable quote (use the debug fixture) appearing as unverified.
6. Stop an answer mid-stream; reload; the partial answer is still there.
7. Select two contracts; ask a comparative question.
8. Compare two versions; filter High; click the AED 100,000 → 1,000,000 change.
9. Redline a DOCX: instruction → preview → download → open in Word/LibreOffice and accept one revision, reject another.
10. State what does not work.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| PDF text extraction differs from what the model quotes (line breaks, headers, columns, tables) | Normalised matching with two views plus a whitespace-free fallback; header/footer stripping; documented failure modes. |
| Gemini free-tier rate limits | Concurrency cap, retries with backoff, large chunks to keep call count low, partial-coverage handling. |
| `pdfjs-dist` is awkward inside Next.js server bundling | Spike in Phase 0; escape hatch is a standalone Node script run as a child process. |
| LibreOffice conversion changes layout vs Word | Accepted: viewer shows the converted PDF; documented. |
| Adeu TypeScript API differs from what we expect | Spike first in Phase 8; fallback is the Python `adeu` CLI in the Docker image. |
| Three-day deadline | Phases are ordered by grading value; the cut list in `Phases.md` says what to drop first. |
| Claiming features that do not work | Rule in `Rules.md`: a phase is done only when its acceptance checks pass; README written from `Memory.md` status. |

## 11. Deliverables checklist

- [ ] GitHub repository (no secrets)
- [ ] Live deployed link running the real build
- [ ] README: what it does, screenshots (upload, chat with verified quotes, citation highlighting, comparison), local run, finished vs not finished
- [ ] Demo video, 3 to 5 minutes, following section 9
- [ ] Half-page note: how verification works and where it can fail; how large documents are handled; Part C choice, how far it got, hardest part; what is next

## 12. Traceability to the assignment

| Assignment item | Requirements |
|---|---|
| 1 Document upload and processing | FR-1.1 to 1.8 |
| 2 Chat with a document | FR-2.1 to 2.7 |
| 3 Verified quotes | FR-3.1 to 3.7 |
| 4 Large documents | FR-4.1 to 4.4 |
| 5 Citation highlighting | FR-5.1 to 5.6 |
| 6 Multi-document questions | FR-6.1 to 6.5 |
| 7 Document comparison | FR-7.1 to 7.8 |
| Part C Option 1 | FR-8.1 to 8.8 |
| Interface quality | FR-9.1 to 9.4 |

## 13. Assumptions

- Contracts are English, left-to-right, with selectable text.
- One person uses the deployment; no access control beyond an unguessable URL.
- Gemini free-tier or low-cost paid access is available through the OpenAI-compatible endpoint. Model names rotate, so the model is an environment variable.
