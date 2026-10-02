# Engineering Assignment: Legal Contract Analysis Web App

**Project Working Title:** Verbatim  
**Target Submission Window:** 3 days from assignment receipt  
**Evaluation Primary Benchmark:** Live deployed application evaluated by assessors testing real contracts, backed by GitHub repository, README, demo video, and half-page reflection note.

---

## 1. Executive Summary & Objective

Build a web application for analysing legal contracts. A user uploads a contract (`PDF` or `DOCX`) and asks questions about it in a chat. The application answers using **only** what is present in the document and backs every answer with the **exact verified quote** it came from. Clicking a quote takes the user directly to that passage in the document with visual highlighting.

- **Target Persona:** Single user (in-house counsel, paralegal, deal/procurement analyst, contract negotiator).
- **Authentication:** No login or account system needed (assume single user).

---

## 2. Core Requirements Breakdown

### Part A: Core Features

#### 1. Document Upload and Processing
- **File Type Support:** Strictly accept `.pdf` and `.docx`. Reject any other file types with a clear, user-friendly error message.
- **Text & Geometry Extraction:** Extract text, preserve structure, and store it.
- **Processing Status:** Provide continuous, visible processing status while ingestion takes place (e.g., upload progress, DOCX-to-PDF conversion, text extraction, page parsing). The user must **never** be left wondering whether anything is happening.
- **Scanned PDF Handling:** Detect scanned/image-only PDFs with no readable text. Explicitly notify the user instead of saving an empty document and treating it as successful. (Invariant I-6).
- **Document Library:** Comprehensive library interface where uploaded files can be listed, opened, inspected, and deleted.

#### 2. Chat with a Document
- **Document-Grounded Q&A:** Ask questions about an uploaded document and get answers restricted strictly to document content.
- **Answer Streaming:** Responses stream in token-by-token / chunk-by-chunk in real time as they are generated, not buffered until completion.
- **Generation Cancellation:** The user can abort / stop an answer while it is streaming. Whatever partial text and verified quotes were generated up to that point are retained in the chat.
- **Chat History:** Chat sessions and history are saved per document and can be reopened anytime.

#### 3. Verified Quotes (The Most Critical Requirement)
- **Document Evidence Backing:** Every answer must be backed by exact quotes from the document.
- **Programmatic Server-Side Verification:** Before any quote is displayed to the user, the application code must confirm that the quote actually exists in the document text.
- **Verification Outcomes:**
  - *Quote found:* Displayed clearly as **Verified**, with click-to-view interaction.
  - *Quote not found (hallucinated / paraphrased):* Must **never** be presented as genuine. Either remove it entirely or flag it prominently as unverified (collapsed / warning state). The compose step must only synthesize answers from verified quotes.
- **Zero Trust in AI Coordinates:** Do not trust any position, page number, bounding box, or character offset reported by the LLM. The server-side code locates the quote in the canonical text independently.
- **Whitespace & Formatting Normalization:** Allow for whitespace differences (line wraps, hyphenation, multiple spaces, tabs, paragraph breaks). Text extraction introduces differences without altering semantics; strict exact matching will wrongly reject genuine quotes.
- **Honest Absence:** If the answer is not present in the document, the app must explicitly state so rather than hallucinating or inventing an answer.

#### 4. Large Documents (150+ Pages)
- **Scalability:** Contracts of 150 pages must work reliably without exceeding LLM context windows or crashing the server.
- **Chunking / Windowing Strategy:** Document must be partitioned intelligently (e.g., sections, clauses, page windows).
- **Honest Coverage Rule:** If the application only processed or read part of a document, it must **never** answer as though it read the entire document. Confidently claiming that a clause does not exist after reading only the first 30 pages is graded as the worst possible failure. Every response must include a coverage disclosure.

---

### Part B: Advanced Features (All Required)

#### 5. Citation Highlighting
- **Interactive Navigation:** Clicking a verified quote in an answer opens the document viewer, automatically scrolls to that passage, and visibly highlights it.
- **Coordinate & Layout Mapping:** Map extracted text back to the rendered PDF page coordinates.
- **Edge Cases Handled:**
  - Quotes spanning multiple lines.
  - Quotes crossing page boundaries / page breaks.
  - Quotes with identical text appearing in multiple places in the document (disambiguated by section/context or cycling).

#### 6. Multi-Document Questions
- **Cross-Document Querying:** The user selects multiple documents from the library and asks a single question across all of them.
- **Document Attribution:** Each quote explicitly identifies which document it came from.
- **Comparative Synthesis:** The answer synthesizes and compares across documents (e.g., differences in liability caps, governing laws, termination notice periods) rather than outputting isolated separate silos.
- **Per-Document Quote Verification:** Each quote is verified independently against its originating document's canonical text, never against a concatenated blob.

#### 7. Document Comparison (Version Diffing)
- **Version Comparison:** Upload or select two versions of a contract (e.g., v1 vs v2, draft vs executed) to inspect changes.
- **Clause / Paragraph Level Granularity:** Identify additions, deletions, and modifications at the clause/paragraph level rather than raw character diffs.
- **Substantive Plain-Language Summary:** Generate a plain-language summary of what changed in substance (distinguishing cosmetic wording tweaks from material legal changes, such as liability caps changing from AED 100,000 to AED 1,000,000).
- **Significance Filtering & Sorting:** Allow users to filter or sort changes by legal significance (Critical / High / Medium / Low).

---

### Part C: Selected Challenge (Choose One)

> **Chosen Option:** **Option 1: Tracked-Change Redlining**  
> *(Aligned with `docs/PRD.md`, `docs/Architecture.md`, and `docs/Phases.md`)*

#### Option 1: Tracked-Change Redlining Requirements
- **Plain-Language Instruction:** User inputs a requested change in plain English (e.g., *"make the liability cap mutual"*, *"extend termination notice from 30 to 60 days"*).
- **Native Word Tracked Changes:** The app writes the revised wording back into the original `.docx` file as genuine Word tracked changes (`w:ins` insertions and `w:del` deletions with author and timestamp metadata).
- **Office / LibreOffice Compatibility:** The downloaded `.docx` must open cleanly in Microsoft Word or LibreOffice with edits displayed as revisions the user can accept or reject individually.
- **Formatting Preservation:** All original document formatting must survive untouched: fonts, bold/italic, indentation, paragraph numbering, bullet hierarchies, tables, styles, headers/footers.
- **Targeted Edits:** Only the modified text is touched; nothing else is reformatted or renumbered.
- **Multi-Run Handling:** Correctly handle text runs split across internal XML fragments (`<w:r>`) without corrupting document structure.
- **Anti-Cheat Constraint:** Regenerating the whole document from scratch or diffing plain text into a new docx produces hundreds of spurious changes and is explicitly disallowed.
- **Implementation Strategy:** Powered by `@adeu/core` (Adeu engine) with fallback to Python `adeu` CLI.

*(Alternative Option 2: Agentic document research with multi-round loop, tool calling, query status visualization, and hard loop limits - noted as the alternative).*

---

### Extras & Bonus Capabilities (Optional, Only After Parts A, B, C)
1. **Anonymisation:** Replace PII (names, companies, emails, phones) with deterministic reversible tokens (e.g., `[PERSON_1]`).
2. **Semantic Search:** Embeddings for vector retrieval alongside structural scanning.
3. **Export:** Export Q&A answers with verified quotes as formatted PDF/Word documents.
4. **Clause Extraction:** Automatic identification and extraction of standard boilerplate clauses (termination, indemnification, governing law).
5. **Arabic Support:** Arabic text extraction and RTL layout handling.
6. **Background Processing Recovery:** Resume and recover in-progress jobs across server restarts.
7. **Voice Input:** Speech-to-text question asking.

---

## 3. Technology Stack & Constraints

- **Framework:** Next.js (App Router, TypeScript `strict`) preferred.
- **Styling:** Tailwind CSS + Radix / shadcn/ui components for clean, professional legal-grade UI.
- **Database / Storage:** MySQL 8 with Prisma ORM; document BLOBs stored in DB for stateless container deployment.
- **LLM Integration:** OpenAI SDK pointed at LLM provider endpoint (e.g., Google Gemini OpenAI-compatible endpoint). Base URL, model name, and API key driven via environment variables.
- **PDF Engine:** `pdfjs-dist` for server-side text/coordinate extraction; `react-pdf-highlighter-extended` for browser viewing & highlighting.
- **DOCX Conversion:** Headless LibreOffice (`soffice`) for DOCX to PDF conversion.
- **Redlining:** `@adeu/core` for Word XML tracked-change AST manipulation.
- **Security Constraint:** **DO NOT COMMIT API KEYS TO THE REPOSITORY.** Server-side environment variables only.

---

## 4. Evaluation Criteria & Anti-Patterns

### What the Evaluators Assess:
1. **Accurate Functionality & Quality:** The live deployed application will be tested by reviewers uploading their own contracts and testing edge cases.
2. **Interface Quality:** Polished, professional UI; typography; distinct loading, empty, and error states; intuitive without instructions.
3. **Sound Engineering Judgement:** Clear justification for architectural choices, trade-offs, and edge-case handling.
4. **Documentation & Honesty:** Clear README, accurate reflection note, honest disclosure of limitations.

### Critical Failure Modes ("Counts Against You"):
- ❌ **Claiming something works when it does not.**
- ❌ **Committed API keys in git history or files.**
- ❌ **An app that only works on toy 2-page samples but fails on 150-page real contracts.**
- ❌ **False absence:** Claiming a clause does not exist after checking only a fraction of the document.
- ❌ **Displaying hallucinated quotes as verified.**
- ❌ **Trusting LLM-reported page numbers or bounding boxes.**
- ❌ **Rejecting genuine quotes due to line breaks or whitespace extraction quirks.**
- ❌ **Treating scanned/blank PDFs as successful uploads.**
- ❌ **Faking Word tracked changes by overwriting text or corrupting DOCX XML.**

---

## 5. Required Submission Deliverables

1. **GitHub Repository Link:** Clean git history, no committed keys, strict typing, tests.
2. **Deployed Live Link:** Publicly accessible deployed URL (Railway, Render, Fly.io, or Vercel).
3. **README.md:**
   - App overview and key capabilities.
   - High-resolution screenshots of core screens (Upload, Chat with verified quotes, Citation highlighting, Document comparison, Redlining).
   - Local development setup instructions.
   - Transparent feature status matrix (what is finished vs what is known limitation).
4. **Demo Video (3 to 5 minutes):**
   - Uploading a document.
   - Asking questions and streaming responses.
   - Quote verification in action (verified vs rejected).
   - Clicking quotes to highlight citations on the PDF viewer.
   - Document comparison workflow.
   - Part C demonstration (Tracked changes in Word).
   - Explicitly showing edge cases and honest boundaries.
5. **Short Note (Half a Page):**
   - How quote verification works and edge cases where it could fail.
   - How large documents (150+ pages) are handled and coverage honesty.
   - Which Part C option was chosen (Option 1: Redlining), why, how far completed, and the hardest technical hurdle.
   - What would be built next given more time.

---

## 6. Project Documentation Index

| Document | Purpose |
|---|---|
| [ASSIGNMENT.md](file:///d:/ASSISMENT/docs/ASSIGNMENT.md) | This file: Complete assignment specification, requirements, constraints, and rubrics. |
| [PRD.md](file:///d:/ASSISMENT/docs/PRD.md) | Product Requirements Document: User stories, acceptance tests, functional requirements (FR-1.1 to FR-7.5). |
| [Architecture.md](file:///d:/ASSISMENT/docs/Architecture.md) | System architecture: Pipelines, data schemas, verification engine, PDF geometry, API contracts. |
| [Rules.md](file:///d:/ASSISMENT/docs/Rules.md) | Assistant rules & invariants (I-1 through I-10), coding standards, stack boundaries. |
| [Phases.md](file:///d:/ASSISMENT/docs/Phases.md) | 10-phase execution plan with specific tasks, test checks, and cut list. |
| [Design.md](file:///d:/ASSISMENT/docs/Design.md) | Design tokens, typography (serif document / sans app), layout, component specs, microcopy. |
| [Prompts.md](file:///d:/ASSISMENT/docs/Prompts.md) | Complete prompt engineering catalog: Extract, Verify, Compose, Multi-Doc, Compare, Redline. |
| [Memory.md](file:///d:/ASSISMENT/docs/Memory.md) | Active project state, phase tracker, verified library facts, decisions log. |

---

## 7. Reference Repositories & Implementation Flow

All reference repositories in `D:\ASSISMENT\` are the project owner's code. You have complete freedom to reuse, adapt, copy, and port algorithms, prompts, components, and utilities directly without license restrictions:

| Repo Identifier | Stack | What it provides | Designated Role in Verbatim |
|---|---|---|---|
| `legal-lens`<br>(`legal-lens-main`) | Python (FastAPI) + React (Vite/TS) | PDF/DOCX upload with async background indexing, per-page text endpoint, RAG chat with citations, two-document compare endpoint, 12 clause templates, Render/Railway deploy files, 30+ tests | **Main base codebase**<br>The starting foundation. We build on it directly, strip its baggage (JWT auth/multi-tenancy, MongoDB dependency, TXT uploads), and fix its critical gaps (scanned PDF handling, 150-page coverage, quote verification). |
| `rag-over-pdf`<br>(`SUGGESTED-REPO/rag-over-pdf-main`) | TypeScript / Next.js | Multi-document chat where each chunk carries a doc ID, streamed citations then tokens via NDJSON, and a 400 error for scanned PDFs with no text | **Pattern reference for A1, A2, B6**<br>Scanned PDF detection (400 response), NDJSON streaming citations + token event protocol (`lib/citations.ts`), multi-doc chunk tagging. |
| `rag-contract-analyzer`<br>(`SUGGESTED-REPO/rag-contract-analyzer-main`) | Python (FastAPI) | Small and readable. Page-cited answers, refuses when context is insufficient, deterministic keyword pass followed by an LLM check | **Fallback base & risk taxonomy**<br>Prompt patterns for refusing when context is insufficient, two-stage idea for ranking change significance, risk term taxonomy (`risk_terms.yaml`). |
| `ragadoc`<br>(`SUGGESTED-REPO/ragadoc-main`) | Python (Streamlit) | Highlights citations inside the PDF using PyMuPDF | **Citation highlighting reference**<br>Approach for matching quoted text to bounding boxes and rendering visual highlights inside PDF pages. |
| `adeu`<br>(`@adeu/core` npm / repo) | Python & Node | Converts DOCX to Markdown for the LLM, then applies edits back as real `w:ins`/`w:del` tracked changes. Normalizes split runs and whitespace variations | **Part C Option 1 engine**<br>DOCX tracked-change generation engine preserving Word XML formatting, paragraph numbering, and tables without full-document regeneration. |
| `eula-diff`<br>(`SUGGESTED-REPO/eula-diff-main`) | Go | Aligns clauses rather than lines, gives a confidence level, and does word-level redlines inside changed clauses | **Design reference for B7**<br>Clause alignment heuristics, confidence scoring, word-level inline diff presentation for modified clauses. |
| `compare-cli`<br>(`SUGGESTED-REPO/compare-cli-main`) | Node | Clause-aware drift detection that ignores moved clauses with identical content | **Design reference for B7**<br>Clause-aware drift detection recognizing identical moved clauses as MOVED rather than Added + Removed. |
| `contract_comparison`<br>(`SUGGESTED-REPO/contract_comparison-main`) | Full-stack | Severity levels for contract changes, DOCX/PDF reports | **Reference for significance ranking**<br>Change severity taxonomy (Critical, High, Medium, Low) and presentation structure. |
| `react-pdf-highlighter-extended`<br>(`SUGGESTED-REPO/react-pdf-highlighter-extended-main`) | JS/TS library (PDF.js) | Text highlights in a PDF viewer | **Frontend half of B5**<br>PDF rendering with bounding-box highlights, multi-page selection, and programmatic scroll-to-citation. |

### Technical Verification Boundary (Invariant I-4)
While all code from reference repositories can be freely reused, **nothing fuzzy or semantic may enter `lib/verify` or the quote verification path** (Invariant I-4). Quote verification must remain strict, deterministic substring search over canonical normalized text to ensure hallucinated or paraphrased quotes are never marked verified.
