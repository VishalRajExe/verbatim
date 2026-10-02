# Verbatim: Architecture, Verification, and Engineering Decisions

## 1. How Citation Verification Works

Verbatim guarantees that every cited quote exists verbatim in the source contract through a multi-stage deterministic verification pipeline (`src/lib/verify/verify-quote.ts`):

1. **Dual Normalized Views & Offset Mapping**:
   - For every document, two authoritative normalized views (`keep` and `join`) are generated and cached in an in-memory LRU cache (`src/lib/text/views.ts`).
   - Normalization executes Unicode NFKC per codepoint, preserving an exact `map[i]` pointing to the character offset in the raw canonical text. Ligatures (e.g. `ﬁ` → `fi`) and non-breaking hyphens are mapped to source offsets without loss.
   - The `join` view additionally repairs line-break hyphenations (e.g. `termi-\nnation` → `termination`).
   - A `loose` view (collapsing all whitespace) serves as a secondary fallback for extraction artifacts where pdf.js joined or split adjacent tokens.

2. **Strict Verification Rules**:
   - **Length Guard**: Quotes must be between 20 and 2,000 characters.
   - **Ellipsis Decomposition**: Quotes containing ellipses (`…`, `...`, `[...]`) are segmented into sub-clauses (each ≥ 20 characters). The quote is only verified if every individual segment appears in the document in chronological order.
   - **Exact Occurrence Matching**: All occurrences (capped at 50) are located. The primary occurrence defaults to the extraction chunk or the first appearance in the document.
   - **Cross-Document Attribution Guard (Invariant I-7)**: In multi-document comparisons, a quote attributed to Document A that only exists in Document B is rejected with `failReason: "WRONG_DOCUMENT"`.
   - **Geometry Locating**: Character offsets are mapped to physical PDF bounding rectangles per page (`src/lib/verify/locate.ts`) using pdf.js text item coordinates converted to top-left origin space.

## 2. Where Verification Fails (Honest Limitations)

1. **Complex Multi-Column Layouts & Tables**: When PDF text streams interleave columns or table cells out of natural reading order, cross-cell or cross-column quotations may fail sequential matching.
2. **Dynamic / Non-Repeating Page Furniture**: Headers, footers, or margin notes that vary across pages (and thus do not meet the 40% repetition threshold for furniture stripping) can interrupt sentences spanning page boundaries.
3. **Model "Helpfulness" / Paraphrasing**: If the LLM corrects typos, alters capitalization, or normalizes punctuation, the quote fails verification intentionally. Verbatim strictly enforces exact source fidelity.
4. **Scanned Images**: PDFs lacking digital text layers are flagged at ingestion as `NO_TEXT_LAYER` and cannot be queried.
5. **Syntactic vs. Semantic Truth**: Verification proves the *words exist* in the agreement; it does not prove the model correctly interpreted their legal significance.

## 3. Large Document Handling & Honest Coverage

Handling 150+ page contracts without hitting rate limits or hallucinating negative facts:

- **Paragraph-Aware Chunking**: Documents are segmented into chunks of ~24,000 tokens (`src/lib/qa/chunker.ts`), splitting strictly on paragraph and section heading boundaries with a small overlap window.
- **Controlled Concurrency**: Extraction runs over all chunks with bounded concurrency (`LLM_MAX_CONCURRENCY = 2`) through an in-process queue, emitting real-time stage progress (`Reading section i of N`).
- **Canonical Deduplication**: Overlapping quotes extracted across chunk boundaries are deduplicated by their canonical `[start, end]` ranges.
- **Coverage Honesty (Invariant I-5)**: If any chunk fails (e.g., provider timeout or 429), the response embeds an amber coverage warning (`Read X of N sections`). The system strictly produces: *"I couldn't find it in the sections I could read (X of N). I can't confirm it's absent"*, never a false negative assertion that the clause does not exist.

## 4. Part C Choice: Redlining (Option 1) and the Hardest Part

We implemented **Option 1: DOCX Tracked Changes (Redlining)**:
- Users provide a natural-language negotiation instruction (e.g., *"Make the liability cap mutual and raise the threshold to AED 250,000"*).
- The pipeline scans candidate clauses, proposes minimal word-level replacements, verifies that each target string occurs **exactly once** in the authoritative DOCX text view (Invariant I-10), and produces genuine Word tracked changes (`<w:ins>` and `<w:del>` elements authored by "Verbatim AI") via `@adeu/core`.

### The Hardest Engineering Challenges:
1. **Target Ambiguity & Non-Destructive Application**: Ensuring that automated text edits never execute on ambiguous targets. If a proposed target occurs 0 or >1 times, it is safely dropped with an honest reason rather than corrupting the document.
2. **Byte-Level XML Formatting Preservation**: Legal agreements rely heavily on nested numbered lists, indentation, bold defined terms, and tables. Applying revisions while guaranteeing that untouched paragraph XML (`<w:p>`) remains 100% byte-for-byte identical was achieved through strict AST diffing and validated by headless LibreOffice smoke tests.

## 5. What Is Next

- **2D Spatial Layout Reading Order**: LayoutLM-style geometric graph sorting to reconstruct reading order across multi-column agreements and complex tables.
- **OCR Fallback Layer**: Local Tesseract / docTR pipeline for scanned exhibits, schedules, and stamped signature execution blocks.
- **Organizational Clause Playbooks**: Integrating standard fallback positions directly into the comparison and redlining workflows.
- **Direct Microsoft Word Add-in**: Running Verbatim's verification and redlining engine natively within Word.
