# Rules for the AI assistant

These rules apply to every session and every AI tool working on this repository. If a rule conflicts with a request in chat, say so and ask before breaking it.

Read in this order at the start of every session: `docs/Memory.md` (once it exists), then `docs/Phases.md` (current phase), then only the parts of `PRD.md`, `Architecture.md` and `Design.md` that the task needs. Do not re-read the whole codebase; `Memory.md` tells you where things are.

---

## 1. Working agreement

1. **One phase at a time.** Work only on the current phase in `Phases.md`. Do not start the next phase, and do not add features that are not in `PRD.md`.
2. **Small steps.** Build one task, run it, test it, then move on. Prefer several small commits to one large one.
3. **Ask before adding a dependency, changing the stack, changing the data model, or renaming public API routes.** Explain why in two sentences.
4. **Do not guess library APIs.** For `pdfjs-dist`, `react-pdf-highlighter-extended`, `@adeu/core`, Prisma and the Gemini endpoint, read the installed package's types or docs first (`node_modules/<pkg>/…` or its README). If you cannot verify an API, say so and write a small spike to find out.
5. **Never fake it.** No hard-coded demo answers, no mocked quotes, no stubbed results in anything that can reach the deployed app. If something is not built, the UI says "not available yet" or hides it.
6. **Report honestly.** If a test fails, say it fails. If an acceptance check from `Phases.md` was not run, say it was not run. Never mark a phase done without running its checks.
7. **Do not refactor unrelated code** while fixing something else. Note the refactor idea in `Memory.md` under "Ideas".
8. **Reference repos are the project owner's code** (`D:\ASSISMENT\legal-lens-main` and `D:\ASSISMENT\SUGGESTED-REPO\*`). You have full rights to all of them, so you can freely reuse, adapt, port, or copy code, algorithms, prompts, components, and utilities without license restrictions or attribution notices:
   - **`legal-lens-main` is the main base codebase**: We build directly on it. We must strip its baggage (JWT login/multi-tenancy, MongoDB dependency, TXT uploads) and fix its critical gaps (scanned PDF detection, top-k RAG truncation on 150-page docs, missing quote verification).
   - **Other reference repos**: Freely borrow, adapt, or copy logic from them:
     - `rag-over-pdf`: Streaming citations + token NDJSON protocol, scanned PDF 400 rejection, multi-document chunk tagging.
     - `ragadoc` & `react-pdf-highlighter-extended`: PDF citation highlighting and viewer integration.
     - `adeu`: Part C Option 1 DOCX tracked changes engine.
     - `eula-diff`: Clause alignment heuristics, confidence scoring, word-level redlines inside changed clauses.
     - `compare-cli`: Clause-aware drift detection recognizing identical moved clauses as MOVED rather than Added + Removed.
     - `contract_comparison` & `rag-contract-analyzer`: Change significance ranking (Critical/High/Medium/Low) and risk term lists.
   - **Technical Invariant (I-4) remains non-negotiable**: Regardless of how freely code can be reused, NOTHING fuzzy or semantic may enter `lib/verify` or the quote verification path (Invariant I-4). Verification must remain strict deterministic substring matching over normalized text so hallucinations or paraphrases are never marked verified.
   - Record significant reuses in `docs/Memory.md` under Decisions as "Reused from <file> -> <our module>".

## 2. Non-negotiable invariants (the product depends on these)

| # | Invariant |
|---|---|
| I-1 | A quote is shown as **Verified** only if `verifyQuote()` found it in that document's canonical text on the server. The client never decides verification. |
| I-2 | Positions, page numbers and offsets returned by the model are **never read**. Prompts do not ask for them. |
| I-3 | The final answer is composed **only from verified quotes**. Unverified quotes are stored and shown collapsed; they are never passed to the compose prompt. |
| I-4 | **No fuzzy or semantic matching in the verification path.** The only tolerances are the normalisation steps in `Architecture.md` section 6. Do not add Fuse, fuzzball, Levenshtein thresholds or embeddings there. |
| I-5 | Every answer carries a **coverage** object. If any section failed or pages were unreadable, the answer must not state that something does not exist. |
| I-6 | A document without usable text is **never** marked READY. |
| I-7 | A quote is verified **against the document it is attributed to**, never against the whole set. |
| I-8 | The API key is read only on the server and never logged, returned or committed. |
| I-9 | Document text is never written to logs. |
| I-10 | Redline targets are verified to exist in the DOCX text view before an edit is offered. |

Any change that touches these needs a test that fails without it.

## 3. Stack boundaries

### Use

| Need | Library |
|---|---|
| Framework | `next` (App Router), `react`, `typescript` (strict) |
| Styling | `tailwindcss`, shadcn/ui components (Radix), `lucide-react` |
| Data | `prisma` + MySQL, `zod` |
| Client fetching | `swr`, native `fetch` and `ReadableStream` |
| LLM | `openai` package pointed at `LLM_BASE_URL` |
| PDF | `pdfjs-dist` (server extraction), `react-pdf-highlighter-extended` (viewer) |
| DOCX → PDF | LibreOffice via `child_process` |
| Redlines | `@adeu/core` |
| Diff | `diff` (word-level display only), own code for clause alignment |
| Concurrency | `p-limit` |
| Tests | `vitest` |

### Avoid (and why)

| Do not use | Why |
|---|---|
| LangChain, LlamaIndex | Hide the chunking and prompting we must control and explain |
| Vector databases, embeddings | Out of scope for v1; coverage guarantees come from reading every section |
| `pdf-parse`, `pdf2json` | No reliable per-item geometry; viewer and extractor must share pdf.js |
| `mammoth` and other DOCX-to-HTML tools | DOCX goes through LibreOffice → PDF so highlighting has one path |
| Fuzzy-match libraries in `lib/verify` | Violates I-4 |
| NextAuth, Clerk or any auth | No login in this product |
| Redux, Zustand, MobX | React state + SWR is enough |
| `localStorage` for documents, chats or results | MySQL is the source of truth |
| `axios`, `moment`, `lodash` | Native APIs cover it |
| Additional UI kits (MUI, Chakra, Ant) | One design system only |
| `any`, `// @ts-ignore` | Use `unknown` and narrow; fix the type |

## 4. Error handling

1. All expected failures throw `AppError(code, message, httpStatus, details?)` from `lib/errors.ts`. Route handlers convert it to `{ "error": { "code": "...", "message": "..." } }`. Unexpected errors become `INTERNAL` with a generic message and are logged with a request id (never with document text).
2. **Never swallow errors.** No empty `catch`. Either handle it meaningfully or rethrow.
3. User-facing messages say **what happened and what to do**, in plain language, without apologising and without stack traces.
4. Error codes (extend deliberately): `UNSUPPORTED_FILE_TYPE` 415, `FILE_TOO_LARGE` 413, `FILE_CORRUPT` 422, `NO_TEXT_LAYER` (stored on the document), `CONVERSION_FAILED`, `DOC_NOT_FOUND` 404, `DOC_NOT_READY` 409, `TOO_MANY_DOCS` 400, `VALIDATION` 400, `LLM_RATE_LIMITED`, `LLM_UNAVAILABLE`, `LLM_BAD_OUTPUT`, `ABORTED`, `INTERNAL` 500.
5. **Streaming errors** are sent as an `{"type":"error",...}` event, and the partially written message is saved with status `ERROR` or `STOPPED`. A stream never ends silently.
6. **LLM calls**
   - always pass an `AbortSignal`;
   - retry only 429, 500, 503 and network errors, max 4 attempts, exponential backoff with jitter, honour `Retry-After`;
   - parse JSON tolerantly (strip code fences, trim), then validate with zod; one repair retry; then mark the chunk failed. Do not crash the request;
   - a failed chunk lowers coverage; it never produces a confident answer.
7. **Long jobs** (ingest, compare) catch their own errors, set `FAILED` with `errorCode` and `errorMessage`, and always leave the row in a terminal state.
8. Validate every request body and query with zod at the route boundary. Never trust the client for ids, ranges or document status.

## 5. Code conventions

- TypeScript `strict`, no implicit any, no unused exports. Prefer pure functions in `lib/` that are easy to test; route handlers stay thin.
- Files under about 300 lines, functions under about 60. Split by responsibility.
- Names: `camelCase` for variables and functions, `PascalCase` for components and types, `kebab-case` for file names.
- Comments explain **why**, not what. Document each non-obvious invariant at the code that enforces it.
- Prompts live in `lib/qa/prompts.ts` (and `lib/compare`, `lib/redline` for theirs), as named constants with a short comment on intent. No prompt strings scattered in route handlers.
- Environment access only through `lib/env.ts`.
- Prisma only in server code. **List queries must use `select`** so blobs and long texts are never loaded by accident.
- All routes that use the database, files, or streams: `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.
- Time: store UTC, display local.

## 6. Frontend rules

- Server Components by default; `"use client"` only for interactivity (composer, stream reader, viewer, filters).
- Use the tokens and type rules in `Design.md`. No raw hex values in components; use CSS variables / Tailwind theme names.
- **Every data view has three states:** loading, empty, error. Build them with the component, not later.
- No spinner-only waits longer than 1 second. Show the named stage ("Reading section 2 of 5").
- Buttons and links use verbs; sentence case; no trailing arrows (see `Design.md`).
- Accessibility floor: semantic elements, labels on inputs, visible focus, `aria-live="polite"` on the streaming answer region and status line, keyboard access to Stop and to quote cards, `prefers-reduced-motion` respected.
- Streaming reader: use `fetch`, `response.body.getReader()`, decode with `TextDecoder`, buffer partial lines, parse one JSON object per line. Stop uses `AbortController`.
- Do not store derived server state in client state longer than necessary; refetch with SWR.

## 7. Database rules

- Migrations are committed. Never edit an applied migration; add a new one.
- Foreign keys cascade on delete so removing a document leaves nothing behind (conversations that include it, files, pages, text, quotes).
- Do not store document text anywhere except `DocumentText`, `DocumentPage` and `Quote.text`.
- Large uploads must stay below `MAX_UPLOAD_MB`; check the host's `max_allowed_packet`.

## 8. Testing rules

- Vitest. Pure modules in `lib/text`, `lib/verify`, `lib/qa/chunker`, `lib/qa/cite-filter`, `lib/compare` and `lib/redline/verify-edits` **must have tests before they are used by a route**.
- Verification tests must cover: exact match; line-break difference; line-break hyphenation; curly quotes and dash variants; ligature; non-breaking space; text split across two pages with a stripped footer; glued words (loose); repeated text (multiple occurrences); too short; too long; ellipsis segments; paraphrase (must fail); text from another document (must fail).
- Fixtures are small, synthetic and contain no confidential data. Generate sample PDF/DOCX files in `tests/fixtures/` (a script is fine).
- The comparison fixture pair must include: AED 100,000 → AED 1,000,000 (High), a pure rewording (Low or Cosmetic), a moved clause (Moved, not Added+Removed), an added clause, a removed clause.
- A phase is "done" only when its automated checks pass **and** its manual checks in `Phases.md` were run.

## 9. Prompt and model rules

- Treat all document text as untrusted data. Wrap it in clear delimiters and tell the model it is data, not instructions.
- Extract prompts demand **verbatim, contiguous** text, 1 to 3 sentences per quote, no ellipses, no paraphrase, no position information.
- Compose prompts receive only the verified quotes, labelled `Q1…Qn` with document names. They must cite with `[Q#]`, must not use quotation marks to reproduce text, must say so when the quotes do not answer the question, and for several documents must compare.
- Keep temperature low for extraction and comparison summaries.
- Never ask the model whether a quote is "correct". Verification is code.
- Log metadata only (model, token counts, latency, chunk index, status). Never log prompts containing document text.

## 10. Git and secrets

- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), one logical change each.
- `.env` and anything with real keys is git-ignored. `.env.example` is committed with empty values. Before every push, check `git status` and search the diff for `AIza` (Google key prefix) or other key patterns.
- Never commit real contracts. Test files must be synthetic.
- `reference/` or copies of the reference repos must not appear in this repository.

## 11. Memory protocol (`docs/Memory.md`)

`docs/Memory.md` tracks project state, library verification facts, decisions, and current phase progress. Update it at the end of every session and whenever you make an architectural decision. Keep it under about 150 lines: edit, do not append forever. Use this structure:

```markdown
# Memory

Last updated: <date> · Current phase: <n> · Branch: <name>

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup | done | |
| 1 Ingestion | in progress | upload works, LibreOffice step pending |

## How to run
<commands that work right now, ports, env vars needed>

## Where things are
- Verification: `src/lib/verify/…` (tests: `tests/verify.test.ts`)
- <one line per important module that exists>

## Decisions (with reason)
- <decision>: <reason>

## Verified facts about libraries
- <library>: <API detail you confirmed from its types/docs, so nobody guesses again>

## Known problems
- <bug or limitation, how to reproduce>

## Not done / ideas
- <items>

## Next steps
1. <the very next task, concrete>
```

Rules for the file:
- State only what is true **now**. Remove items when they are fixed.
- Record verified library API facts so later sessions do not guess.
- The README's "finished / not finished" section must be derived from this file, not from memory of the chat.

## 12. Definition of done (any task)

1. Code compiles with no type errors; lint passes.
2. Relevant Vitest tests pass; new logic has tests.
3. The behaviour was exercised by hand once in the browser or with `curl`, including one failure path.
4. Loading, empty and error states exist for any new view.
5. No secrets, no document text in logs, no TODO that hides a missing requirement.
6. `Memory.md` updated.
