# Architecture: Verbatim

Read `PRD.md` first. Requirement IDs (FR-x.y) refer to it.

## 1. Big picture

One Next.js app (UI + API routes) in one Docker container, plus one MySQL database. No other services.

```
Browser (React)                      Next.js server (Node runtime)                 External
┌──────────────────────┐   HTTP      ┌─────────────────────────────────────────┐
│ Library | Chat | PDF │ ──────────► │ Route handlers  /api/*                  │
│ viewer (pdf.js)      │ ◄────────── │   upload · conversations · compare ·    │
│                      │  JSON +     │   locate · redline                      │
│                      │  NDJSON     │                                         │
└──────────────────────┘  stream     │ Domain code  src/lib/*                  │
                                     │   ingest · text · verify · qa ·         │ ──► Gemini
                                     │   compare · redline · llm · jobs        │     (OpenAI-compatible
                                     │                                         │      endpoint)
                                     │ In-process job runner (DB-backed)       │
                                     │ LibreOffice (child process)             │
                                     └───────────────┬─────────────────────────┘
                                                     │ Prisma
                                                     ▼
                                                  MySQL 8
                          documents · files (BLOB) · pages · text · conversations ·
                          messages · quotes · comparisons · changes · redlines
```

**Design choices that matter**

1. **Files live in MySQL** (LONGBLOB in a separate table). The deployed container needs no persistent disk, only a MySQL service. Single-user scale makes this fine.
2. **One text source of truth per document**: the *canonical text*, built once at ingestion from pdf.js text items, with every character traceable to a page and a rectangle.
3. **The same engine extracts and renders**: pdf.js on the server for text and geometry, pdf.js in the browser for display, so coordinates line up.
4. **DOCX is converted to PDF with LibreOffice** and treated exactly like a PDF for text, Q&A and highlighting. The original `.docx` is kept for redlining (Part C).
5. **The model never reports positions.** It returns quote text only. Our code finds the text.
6. **The model never writes the final answer from raw document text.** It writes from a list of already-verified quotes (extract → verify → compose).

## 2. Technology stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Node.js LTS (22 or 24) | Pin in `.nvmrc` and Dockerfile |
| Framework | Next.js, latest stable, App Router, TypeScript `strict` | Route handlers use `runtime = 'nodejs'` |
| UI | React, Tailwind CSS, shadcn/ui (Radix primitives), lucide-react | Tokens in `Design.md` |
| Client data | `swr` for polling and fetching | Streaming answer uses `fetch` + `ReadableStream` |
| Database | MySQL 8 | `utf8mb4`. Docker image for local dev |
| ORM | Prisma | `Bytes @db.LongBlob`, `String @db.LongText`, `Json` |
| LLM client | `openai` npm package | Pointed at Gemini's OpenAI-compatible endpoint through env vars |
| Validation | `zod` | Env, request bodies, LLM JSON outputs |
| PDF text and geometry | `pdfjs-dist` (legacy build for Node) | Pin the same version as the viewer needs |
| PDF viewer | `react-pdf-highlighter-extended` | Uses pdf.js; takes rectangles from our `locate` endpoint |
| DOCX → PDF | LibreOffice headless (`soffice`) | In the Docker image; per-job profile dir |
| Tracked changes | `@adeu/core` (TypeScript SDK of Adeu) | Spike first; fallback is the Python `adeu` CLI |
| Word-level diff | `diff` (jsdiff) | Only for showing changed words inside a modified clause |
| Concurrency | `p-limit` | LLM calls and job runner |
| Tests | Vitest | Fixtures in `tests/fixtures/` |
| Package manager | npm | `package-lock.json` committed |
| Deploy | Docker on Railway (app + MySQL plugin) or similar | Verify current free-tier limits before choosing |

### LLM configuration (assignment requirement: key, base URL, model from env)

```
LLM_API_KEY=            # your Gemini API key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-2.5-flash       # model names rotate; keep configurable and check Google's docs
```

Gemini's OpenAI-compatible endpoint supports streaming and JSON / structured output (checked against Google's docs). Free-tier rate limits are low (roughly 5 to 30 requests per minute depending on model, and changed in late 2025), so the design uses **few, large calls** and **limited concurrency** (section 8).

## 3. Repository layout

```
verbatim/
├─ docs/                       PRD.md Architecture.md Rules.md Phases.md Design.md Memory.md
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
├─ src/
│  ├─ instrumentation.ts       on server start: recover unfinished jobs
│  ├─ app/
│  │  ├─ layout.tsx            fonts, tokens, shell
│  │  ├─ page.tsx              library + upload
│  │  ├─ documents/[id]/page.tsx   chat + viewer for one document
│  │  ├─ ask/page.tsx          multi-document chat
│  │  ├─ compare/page.tsx      version comparison
│  │  └─ api/
│  │     ├─ documents/route.ts                     GET list · POST upload
│  │     ├─ documents/[id]/route.ts                GET meta · DELETE
│  │     ├─ documents/[id]/rendition/route.ts      GET pdf bytes
│  │     ├─ documents/[id]/original/route.ts       GET original download
│  │     ├─ documents/[id]/locate/route.ts         GET rectangles for char ranges
│  │     ├─ conversations/route.ts                 GET (by document) · POST
│  │     ├─ conversations/[id]/route.ts            GET · DELETE
│  │     ├─ conversations/[id]/messages/route.ts   POST question → NDJSON stream
│  │     ├─ comparisons/route.ts                   POST · GET list
│  │     ├─ comparisons/[id]/route.ts              GET (filter/sort query params)
│  │     ├─ redlines/route.ts                      POST propose edits
│  │     ├─ redlines/[id]/apply/route.ts           POST build .docx
│  │     ├─ redlines/[id]/download/route.ts        GET
│  │     └─ health/route.ts
│  ├─ components/
│  │  ├─ ui/                   shadcn primitives
│  │  ├─ library/              dropzone, document list, status pipeline
│  │  ├─ chat/                 thread, composer, quote card, coverage badge
│  │  ├─ viewer/               pdf viewer wrapper, match stepper
│  │  ├─ compare/              change list, filters, side-by-side
│  │  └─ redline/              instruction box, edit list, diff preview
│  └─ lib/
│     ├─ env.ts                zod-validated environment
│     ├─ db.ts                 Prisma singleton
│     ├─ errors.ts             AppError + error codes
│     ├─ http.ts               json(), error mapping, ndjson helpers
│     ├─ llm/                  client.ts · retry.ts · limiter.ts · json.ts (tolerant JSON parse)
│     ├─ ingest/               pipeline.ts · validate.ts · extract-pdf.ts · convert-docx.ts
│     │                        strip-furniture.ts · build-canonical.ts · scan-check.ts
│     ├─ text/                 normalize.ts · views.ts (offset maps) · tokens.ts
│     ├─ verify/               verify-quote.ts · split-ellipsis.ts · locate.ts
│     ├─ qa/                   pipeline.ts · chunker.ts · prompts.ts · schemas.ts
│     │                        coverage.ts · cite-filter.ts · ndjson-events.ts
│     ├─ compare/              clauses.ts · align.ts · materiality.ts · categories.ts
│     │                        summarize.ts · pipeline.ts
│     ├─ redline/              view.ts · propose.ts · verify-edits.ts · apply.ts · validate-docx.ts
│     └─ jobs/                 runner.ts · recover.ts
├─ tests/
│  ├─ fixtures/                small synthetic PDFs/DOCX (no confidential data)
│  └─ *.test.ts
├─ Dockerfile
├─ docker-compose.yml          app + mysql for local dev
├─ .env.example
└─ README.md
```

Reference repositories (section 11) stay **outside** this repo.

## 4. Data model (MySQL via Prisma)

This is a starting sketch. Follow the installed Prisma version's docs for generator and datasource syntax (it has changed between major versions).

```prisma
enum DocStatus { QUEUED EXTRACTING CONVERTING INDEXING READY FAILED }
enum MsgStatus { STREAMING COMPLETE STOPPED ERROR }

model Document {
  id            String    @id @default(cuid())
  name          String
  kind          String                       // "pdf" | "docx"
  sizeBytes     Int
  sha256        String?
  status        DocStatus @default(QUEUED)
  stage         String?                      // human-readable: "Reading page 40 of 150"
  progress      Int       @default(0)        // 0..100
  pageCount     Int?
  charCount     Int?
  tokenEstimate Int?
  errorCode     String?                      // e.g. NO_TEXT_LAYER
  errorMessage  String?
  warnings      Json?                        // { emptyPages: [3,4], furnitureStripped: true }
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  file          DocumentFile?
  text          DocumentText?
  pages         DocumentPage[]
  convDocs      ConversationDocument[]
  quotes        Quote[]
}

model DocumentFile {                 // blobs kept apart so list queries never load them
  documentId String   @id
  original   Bytes    @db.LongBlob
  rendition  Bytes?   @db.LongBlob   // PDF for DOCX uploads; null for PDF uploads
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}

model DocumentText {                 // canonical text, whole document
  documentId String   @id
  text       String   @db.LongText
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}

model DocumentPage {
  documentId String
  pageNo     Int                     // 1-based
  charStart  Int                     // offset of this page's text inside canonical text
  charEnd    Int
  width      Float                   // pdf.js viewport at scale 1
  height     Float
  items      Json                    // [[start, len, x, y, w, h], ...] start is relative to page text
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  @@id([documentId, pageNo])
}

model Conversation {
  id        String   @id @default(cuid())
  title     String
  kind      String                   // "single" | "multi"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  documents ConversationDocument[]
  messages  Message[]
}

model ConversationDocument {
  conversationId String
  documentId     String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  document       Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  @@id([conversationId, documentId])
}

model Message {
  id             String    @id @default(cuid())
  conversationId String
  role           String                    // "user" | "assistant"
  content        String    @db.LongText
  status         MsgStatus @default(COMPLETE)
  coverage       Json?                     // per-document coverage, see section 8
  errorMessage   String?
  createdAt      DateTime  @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  quotes         Quote[]
}

model Quote {
  id         String   @id @default(cuid())
  messageId  String
  documentId String
  ref        String                         // "Q1" (unique within the message)
  text       String   @db.Text              // exactly what the model returned
  verified   Boolean
  matchKind  String?                        // "exact" | "loose" (null when unverified)
  failReason String?                        // NOT_FOUND | TOO_SHORT | TOO_LONG | WRONG_DOCUMENT
  ranges     Json?                          // [{ segment, primary, occurrences:[{start,end,pageStart,pageEnd}] }]
  message    Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}

model Comparison {
  id         String   @id @default(cuid())
  docAId     String
  docBId     String
  status     String                          // QUEUED | RUNNING | READY | FAILED
  stage      String?
  summary    String?  @db.LongText           // overall plain-language summary
  stats      Json?                           // counts by type and significance
  errorMessage String?
  createdAt  DateTime @default(now())
  changes    ComparisonChange[]
}

model ComparisonChange {
  id           String  @id @default(cuid())
  comparisonId String
  orderIdx     Int
  type         String                        // ADDED | REMOVED | MODIFIED | MOVED
  significance String                        // HIGH | MEDIUM | LOW | COSMETIC
  category     String?                       // liability | payment | termination ...
  title        String
  summary      String  @db.Text
  summarySource String                       // "ai" | "automatic"
  aText        String? @db.Text
  bText        String? @db.Text
  aStart       Int?
  aEnd         Int?
  bStart       Int?
  bEnd         Int?
  comparison   Comparison @relation(fields: [comparisonId], references: [id], onDelete: Cascade)
}

model Redline {
  id         String   @id @default(cuid())
  documentId String
  instruction String  @db.Text
  edits      Json                            // [{ id, target, replacement, reason, verified, include }]
  status     String                          // PROPOSED | APPLIED | FAILED
  output     Bytes?   @db.LongBlob
  createdAt  DateTime @default(now())
}
```

Recovery after restart needs no jobs table: on boot, rows in `QUEUED / EXTRACTING / CONVERTING / INDEXING` (and comparisons in `QUEUED / RUNNING`) are re-queued.

## 5. Ingestion pipeline (FR-1)

```
POST /api/documents (multipart)
  1. validate: extension, MIME, magic bytes (PDF "%PDF-", DOCX zip with word/document.xml), size
       → reject with 415 / 413 and the exact message from PRD FR-1.1/1.2; store nothing
  2. insert Document(QUEUED) + DocumentFile(original)  →  respond 202 { id }
  3. job runner picks it up (concurrency 1, because of LibreOffice):
       a. DOCX: status CONVERTING → soffice --headless --convert-to pdf (timeout, own profile dir)
                → store rendition. On failure: FAILED / CONVERSION_FAILED
       b. EXTRACTING: pdf.js getTextContent() per page
                → text items {str, transform, width, height, hasEOL}
                → progress written to the row every few pages ("Reading page 40 of 150")
       c. scan check: if total non-whitespace chars are tiny, or nearly all pages are empty
                → FAILED / NO_TEXT_LAYER with the PRD message. Otherwise record emptyPages in warnings.
       d. INDEXING:
                - strip page furniture (repeated headers/footers, bare page numbers)
                - build page text from items (spaces and newlines from gaps / hasEOL)
                - assemble canonical text = pages joined with "\n\n"; record per-page offsets
                - store DocumentText, DocumentPage rows (items compact arrays), counts, token estimate
       e. READY
```

**Item geometry** is stored in pdf.js viewport space at scale 1 with a **top-left origin** (convert from PDF user space once, at ingestion), so the viewer can use it directly.

**Page furniture stripping.** For each page, take text lines in the top and bottom bands. Normalise digits to `#`. If the same normalised line occurs on at least 40% of pages, mark those items ignored. Also ignore lines that are only a page number ("12", "Page 12 of 150"). Ignored items are **excluded from page text and from the items array**, so they cannot split a sentence across a page break. This is what makes cross-page quotes verifiable.

**Scanned-PDF rule:** never create a READY document without usable text.

## 6. Text normalisation and offset maps (`src/lib/text`)

Verification works on *views* of the canonical text. A view is a normalised string plus `map[i]` = offset in canonical text of `view[i]`, with a final sentinel entry for the end.

Normalisation applied identically to views and quotes:

1. Unicode NFKC, done per code point so every output char keeps a source offset (ligatures like "ﬁ" become "fi", both mapped to the same source offset).
2. Curly single quotes → `'`; curly double quotes → `"`; en/em dash, minus, non-breaking hyphen → `-`.
3. Remove soft hyphen (U+00AD) and zero-width characters (U+200B to U+200D, U+FEFF).
4. Any run of whitespace (including U+00A0 and newlines) → one space, mapped to the first whitespace char of the run. Trim.

Two views are built per document (lazily, cached in an in-memory LRU keyed by document id):

- **keep view:** as above.
- **join view:** additionally removes a hyphen plus following whitespace when it sits between a letter and a lowercase letter (a line-break hyphenation: "termi-\nnation" → "termination").

A third, **loose key**, is used only as a fallback: remove *all* whitespace from view and quote, keep a map. This catches extraction glitches that glue or split words ("theParties", "Termi nation") without changing the letters.

## 7. Quote verification (FR-3). The core of the project

```
verifyQuote(quoteText, documentId) → VerifyResult

1. q = normalise(quoteText)
2. if q.length < 20 → { verified:false, failReason:"TOO_SHORT" }; if > 2000 → "TOO_LONG"
3. if q contains an ellipsis ("…", "...", "[...]") → split into segments (each ≥ 20 chars).
   Verify each segment independently, in order. The quote is verified only if every segment is.
4. For view in [keep, join]:
      find ALL occurrences of q in view.s (cap 50)
      if any → matchKind "exact"; convert each to canonical [start,end) with the map
5. Else loose key search → matchKind "loose"
6. Else → { verified:false, failReason:"NOT_FOUND" }
7. For each occurrence compute pageStart/pageEnd from DocumentPage offsets.
8. Choose primary occurrence: the first one inside the chunk the quote was extracted from;
   otherwise the first in the document.
```

**Rules**

- Case-sensitive. Conservative on purpose.
- **No fuzzy matching.** A near-match is not verified. (If we ever show "closest passage", it is labelled as a suggestion and never as verified.)
- Verification takes the **document id the model attributed the quote to**. A quote found only in a different document is `WRONG_DOCUMENT`, unverified.
- The caller never passes model-reported positions; there is no parameter for them.

**Where it can fail (state these honestly in the note)**

- Multi-column layouts and tables, where pdf.js text order differs from reading order.
- Text split by footnotes, side notes or text boxes in the middle of a sentence.
- Headers/footers that vary page to page (not repeated enough to be stripped).
- Words that the model "corrects" (typos, capitalisation) – rejected on purpose.
- Scanned pages (no text).
- DOCX files whose LibreOffice rendering reorders text boxes.
- The loose key makes "in to" and "into" indistinguishable. Accepted trade-off.
- Verification proves the *words exist*; it does not prove the model *understood* them.

## 8. Question answering pipeline (FR-2, FR-3, FR-4, FR-6)

Same code path for one document or several, small or large:

```
ask(conversation, question)
  documents = conversation documents (1..5)
  for each document: chunks = chunk(text)          // ~24k tokens each, paragraph boundaries,
                                                   // small overlap; one chunk for short docs
  ── EXTRACT (map) ─────────────────────────────────────────────────────────────
  for each (document, chunk) with limited concurrency (LLM_MAX_CONCURRENCY, default 2):
      emit status {stage:"reading", document, done, total}
      call model: "Return verbatim quotes from <document> that help answer <question>."
        → JSON { quotes:[{ text, why }] }   (zod-validated, tolerant parse, 1 retry)
      failed chunk → recorded in coverage.failedChunks (not fatal)
  ── VERIFY ────────────────────────────────────────────────────────────────────
  emit status {stage:"verifying"}
  for each returned quote: verifyQuote(text, attributedDocumentId)
  dedupe by canonical range; number verified ones Q1..Qn; keep unverified separately
  persist Quote rows; emit {type:"quotes", quotes:[...]} and {type:"coverage", ...}
  ── COMPOSE (reduce, streamed) ────────────────────────────────────────────────
  if no verified quotes:
      deterministic message (no model call):
        coverage complete   → "I couldn't find a passage that answers this in <doc> (all N sections read)."
        coverage incomplete → "I couldn't find it in the sections I could read (X of N). Absence is not confirmed."
  else:
      call model with ONLY the verified quotes (labelled Q1.., with document names)
      → streamed answer that cites with [Q#] markers; for several documents: compare across them
      CitationFilter removes markers that are not in the verified set (works across token boundaries)
      emit {type:"token", text} chunks
  persist message (status COMPLETE | STOPPED | ERROR), emit {type:"done"}
```

**Coverage object (per document)**

```json
{ "documentId": "…", "name": "msa.pdf", "chunksTotal": 5, "chunksRead": 5,
  "failedChunks": [], "pages": 150, "unreadablePages": 0, "complete": true }
```

`complete` is true only if no chunk failed. `unreadablePages > 0` adds a caveat even when complete. The deterministic "not found" text and the coverage badge both come from this object, so the UI cannot show a confident absence on a partial read.

**NDJSON stream** (`POST /api/conversations/:id/messages`, `Content-Type: application/x-ndjson`, one JSON object per line):

```
{"type":"status","stage":"reading","documentId":"…","done":2,"total":5}
{"type":"status","stage":"verifying"}
{"type":"quotes","quotes":[{"ref":"Q1","documentId":"…","documentName":"…","verified":true,"text":"…","pageStart":14,"pageEnd":14,"occurrences":1}, …]}
{"type":"coverage","coverage":[ … ]}
{"type":"token","text":"The liability cap is "}
{"type":"done","messageId":"…","status":"complete"}
{"type":"error","code":"LLM_RATE_LIMITED","message":"…"}
```

**Stop.** The client aborts the fetch. The server listens to `request.signal` and the stream's `cancel()`; it aborts the model call, then saves the partial text with status `STOPPED`. Because the abort can arrive while the response is closing, the save must not depend on writing to the client.

**Prompt-injection stance.** Document text is wrapped in delimiters and described as untrusted data. Verification is the backstop: even a hijacked model cannot make a quote verified unless the words exist in the document.

**Rate limits.** `LLM_MAX_CONCURRENCY` (default 2), retry on 429/503 with exponential backoff and jitter (max 4 attempts, honour `Retry-After`), large chunks to keep the call count low (a 150-page contract is about 5 extract calls). Exhausted retries mark the chunk failed, which reduces coverage; they never crash the request.

## 9. Highlighting (FR-5)

`GET /api/documents/:id/locate?ranges=s1-e1,s2-e2` → for each canonical-text range:

1. Find overlapping pages via `DocumentPage.charStart/charEnd`.
2. For each page, find items whose `[start, start+len)` overlaps the range.
3. For items fully inside: use the item's rectangle. For the first and last item: take a proportional slice of the item's width by character position (approximation; see limits).
4. Merge adjacent rectangles on the same line.
5. Return `[{ pageNumber, width, height, rects:[{x1,y1,x2,y2}], boundingRect }]`.

The client turns this into the highlight format `react-pdf-highlighter-extended` expects (check its types; do not guess), then scrolls to it. Multi-line = several rectangles. Cross-page = rectangles on two pages (the library takes one highlight per page, so create linked highlights and scroll to the first). Repeated text = the `Quote.ranges[].occurrences` list drives the "1 of 3" stepper.

**Limit:** sub-item positions are interpolated from item width; with proportional fonts the highlight edge can be off by a few characters at the start and end of a phrase. Documented, not hidden.

## 10. Comparison (FR-7)

```
compare(docA, docB)
 1. clauses(A), clauses(B): split canonical text into clause/paragraph units using numbering
    patterns (1. / 1.1 / (a) / Article / Section) and blank-line structure; each unit has
    {number?, heading?, text, start, end}
 2. align:
      a. identical after aggressive normalisation → UNCHANGED (or MOVED if order differs)
      b. same number/heading and similarity ≥ 0.5 → MODIFIED
      c. remaining pairs by best bigram-Dice similarity ≥ 0.6 → MODIFIED (renumbered / moved)
      d. unmatched in A → REMOVED; unmatched in B → ADDED
      e. equal after stripping case/punctuation/numbering → COSMETIC
 3. deterministic materiality (floor):
      extract tokens: money (AED/USD/… + amounts), numbers with units (days, months, years),
      percentages, dates, modal words (shall/must/may/will/shall not), negations, "unlimited",
      jurisdictions, party names
      changed tokens in a clause → at least MEDIUM; amount change by ≥ 2× or direction change
      in liability / payment / termination / indemnity / governing-law categories → HIGH
 4. AI pass (batched, ~15 changes per call, limited concurrency):
      input: category hints + old text + new text per change (document text is untrusted data)
      output: { id, significance, title, summary }
      rule: AI may raise significance above the floor, never lower it below the floor
      failure of a batch → automatic summary built from the token diff ("Amount changed from
      AED 100,000 to AED 1,000,000"), labelled summarySource "automatic"
 5. overall summary: AI over the top changes (or automatic if the call fails)
 6. persist Comparison + ComparisonChange rows with aStart/aEnd/bStart/bEnd
```

Changes store their **document offsets**, so "open both versions" reuses `locate`. Category keywords borrow from the clause templates in the reference repos (section 11).

## 11. Redlining, Part C Option 1 (FR-8)

```
POST /api/redlines { documentId, instruction }
 1. require kind = docx
 2. text view of the DOCX from @adeu/core (this, not the PDF text, is what edits must match)
 3. locate relevant clauses: scan chunks of that view (same chunker) asking the model for the
    exact passages relevant to the instruction; verify them with the same verifier on this view
 4. ask the model for minimal edits: [{ target, replacement, reason }]
      - target is an exact substring of a verified passage
      - change only the words that must change; no whole-clause rewrites
 5. verify each target occurs exactly once in the view (more than once → ask for more context
    or drop and report); store Redline(PROPOSED) with per-edit verified flag
POST /api/redlines/:id/apply { includeIds }
 6. apply included edits with RedlineEngine (author "Verbatim AI") → .docx with w:ins / w:del
 7. validate: unzip, count w:ins / w:del, compare untouched paragraphs' XML with the original,
    run a LibreOffice headless conversion as an "opens cleanly" smoke test
 8. store output, offer download
```

The engine handles text split across runs; our job is correct edits, verification, preview, validation and honest reporting. **Phase 8 starts with a spike**: read the package's README and type definitions, apply one edit to a sample DOCX, and open the result before building any UI. Do not guess the API.

## 12. Jobs (restart-safe processing)

- `lib/jobs/runner.ts`: a singleton stored on `globalThis` (so dev hot-reload does not create duplicates) with `p-limit(1)`.
- Row status columns are the queue. The runner processes `QUEUED` documents and comparisons.
- `src/instrumentation.ts` calls `recoverJobs()` when the Node runtime starts: reset in-flight rows to `QUEUED` and enqueue them.
- Assumption: one app instance. Do not scale horizontally without adding row locking.

## 13. Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none | `mysql://user:pass@host:3306/verbatim` |
| `LLM_API_KEY` | none | Gemini key (server only) |
| `LLM_BASE_URL` | Gemini OpenAI-compatible URL | Provider endpoint |
| `LLM_MODEL` | `gemini-2.5-flash` | Model id |
| `LLM_MAX_CONCURRENCY` | `2` | Parallel model calls |
| `LLM_REASONING_EFFORT` | unset | Optional; lowers latency on thinking models (check provider docs) |
| `MAX_UPLOAD_MB` | `25` | Upload cap (keep below MySQL `max_allowed_packet`) |
| `CHUNK_TOKENS` | `24000` | Target tokens per extract call |
| `MAX_DOCS_PER_QUESTION` | `5` | Multi-document limit |
| `SOFFICE_PATH` | `soffice` | LibreOffice binary |
| `REDLINE_AUTHOR` | `Verbatim AI` | Author name on tracked changes |

`.env.example` is committed with empty secrets. `src/lib/env.ts` validates everything at startup and fails fast with a readable message.

## 14. Deployment

- Dockerfile: Node LTS slim base, `apt-get install` LibreOffice Writer and basic fonts (for example `fonts-liberation`, `fonts-dejavu-core`), Next.js `output: 'standalone'`, run `prisma migrate deploy` before start.
- One web service + one MySQL service. No persistent volume needed.
- Do not use serverless hosting: LibreOffice, a background job runner and long streaming responses need a long-running Node process.
- Set the proxy / platform timeouts high enough for streamed answers and disable response buffering (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`).
- Managed MySQL: check `max_allowed_packet` and that the user can create tables.

## 15. Reference repositories (kept in `D:\ASSISMENT`)

All reference repositories are the project owner's code. Logic, algorithms, prompts, components, and utilities can be freely reused, copied, and adapted directly:

| Repo & Directory | Stack | What it's good for | Designated Role in Verbatim |
|---|---|---|---|
| `legal-lens`<br>(`legal-lens-main`) | Python/FastAPI + React (Vite/TS) | PDF/DOCX upload with async background indexing, per-page text API, RAG chat with citations, two-document compare endpoint, 12 clause templates (`clause_library.py`), analysis/compare prompts (`ai_features.py`), Render/Railway deploy files, test suite | **Main base codebase**: We build directly on it, removing JWT/auth and MongoDB baggage, and upgrading with verified quotes and coverage scanning. |
| `rag-over-pdf`<br>(`SUGGESTED-REPO/rag-over-pdf-main`) | TypeScript / Next.js | Multi-document chat where each chunk carries a doc ID, streamed citations then tokens via NDJSON, and 400 error for scanned PDFs with no text | **Pattern reference for A1, A2, B6**: Streaming citations + tokens event protocol (`lib/citations.ts`), scanned-PDF 400 rejection, multi-doc chunk tagging. |
| `rag-contract-analyzer`<br>(`SUGGESTED-REPO/rag-contract-analyzer-main`) | Python/FastAPI | Page-cited answers, prompt for refusing when context is insufficient, deterministic keyword pass followed by LLM check, risk term dictionary | **Fallback base**: Insufficient context refusal prompt logic, risk term taxonomy, two-stage ranking for change significance. |
| `ragadoc`<br>(`SUGGESTED-REPO/ragadoc-main`) | Python/Streamlit | Citation-to-PDF text matching and visual highlighting in PDF (PyMuPDF) | **Citation highlighting reference**: Approaches to matching quotes to visual highlights on rendered PDF pages. |
| `adeu`<br>(`@adeu/core` npm / repo) | Python & Node | Converts DOCX to Markdown for the LLM, then applies edits back as real `w:ins`/`w:del` tracked changes. Normalizes split runs and whitespace variations | **Part C Option 1 engine**: AST-level Word tracked changes preserving document styling, paragraph numbering, and tables. |
| `eula-diff`<br>(`SUGGESTED-REPO/eula-diff-main`) | Go | Aligns clauses rather than lines, gives a confidence level, and does word-level redlines inside changed clauses | **Design reference for B7**: Clause alignment heuristics, confidence scoring, word-level inline diff presentation for modified clauses. |
| `compare-cli`<br>(`SUGGESTED-REPO/compare-cli-main`) | Node | Clause-aware drift detection that ignores moved clauses with identical content | **Design reference for B7**: Detecting and tagging identical relocated clauses as MOVED rather than Added + Removed. |
| `contract_comparison`<br>(`SUGGESTED-REPO/contract_comparison-main`) | Full-stack | Severity levels for contract changes, DOCX/PDF reports | **Reference for significance ranking**: Change severity taxonomy (Critical / High / Medium / Low) and UI presentation. |
| `react-pdf-highlighter-extended`<br>(`SUGGESTED-REPO/react-pdf-highlighter-extended-main`) | JS/TS library (PDF.js) | Text highlights in a PDF viewer | **Frontend half of B5**: PDF rendering with interactive bounding-box highlights and scroll-to-citation. |

> **Technical Invariant (I-4):** Regardless of code reuse, nothing fuzzy or semantic may enter `lib/verify` or the quote verification path (Rules I-4). Verification must remain strict deterministic substring matching over normalized text so hallucinations or paraphrases are never marked verified.

## 16. Items to verify when implementing (do not assume)

1. `pdfjs-dist` in the Next.js server runtime (worker, canvas, bundling). Use `serverExternalPackages` in Next config if needed; otherwise run extraction as a child process script.
2. `react-pdf-highlighter-extended`: exact highlight type, scroll utility, how multi-page highlights are represented.
3. `@adeu/core`: constructor, edit format, how it matches target text, how it saves.
4. Gemini: structured-output option name in the OpenAI-compatible endpoint, reasoning option, current model ids and rate limits.
5. Prisma major-version configuration syntax for MySQL.
6. MySQL `max_allowed_packet` on the chosen host.
