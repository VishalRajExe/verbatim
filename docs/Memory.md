# Memory

Last updated: 2026-10-02 · Current phase: 1 (complete) · Next phase: 2 (Canonical text and verifier) · Branch: main · Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | complete | Upload validation, in-process job queue, DOCX conversion, PDF extraction, furniture stripping, canonical text assembly, library UI with SWR polling |
| 2 Canonical text and verifier | not started | Next task: normalize, views, verifyQuote, locate char ranges to rectangles, test fixtures |
| 3 Chat with one document | not started | |
| 4 Large documents and coverage | not started | |
| 5 Viewer and highlighting | not started | |
| 6 Multi-document questions | not started | |
| 7 Document comparison | not started | |
| 8 Redlining (Part C, Option 1) | not started | |
| 9 Polish, deploy, README, video, note | not started | |

## How to run
- Install: `npm install`
- Database: MySQL running on port 3306 (`root:admin`, database `verbatim`). Docker compose: `docker compose up -d`
- Migration: `npx prisma migrate dev`
- Dev server: `npm run dev` (serves `http://localhost:3000`)
- Health check: `GET http://localhost:3000/api/health`
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Lint: `npm run lint` (`next lint`)
- Tests: `npm test` (`vitest run`)

## Verified facts about libraries
- **Validation & Security**:
  - Validates extension (`.pdf`, `.docx`), MIME types, and magic bytes (`%PDF-`, `PK\x03\x04`).
  - Strict ZIP integrity inspection ensures DOCX files contain `word/document.xml`.
  - Rejection with exact PRD messages for `.xlsx`, `.txt`, renamed `.exe` (`MZ` header), truncated PDFs, and oversized files (>25MB). Nothing is stored on validation failure.
- **pdfjs-dist (v4.4.168)**:
  - Server-side Node runtime requires importing `pdfjs-dist/legacy/build/pdf.mjs` with `{ data, useSystemFonts: true, disableFontFace: true }`.
  - Next.js config needs `serverExternalPackages: ['pdfjs-dist']`.
  - `page.getTextContent()` exposes text items with `str`, `transform` (`[scaleX, skewY, skewX, scaleY, tx, ty]`), `width`, `height`, and `hasEOL`.
  - Vertical line break detection (`Math.abs(ty - prevTy) > 3`) is necessary because `hasEOL` is not reliably set in generated PDFs, preventing adjacent lines from concatenating without whitespace.
  - Coordinate system: PDF native coordinates have origin at bottom-left; converted to top-left origin `top = pageHeight - (ty + itemHeight)` matching web viewer coordinates. Compact items stored as `[start, len, x, y, w, h]`.
- **Scanned PDF & Blank Page Handling**:
  - Documents with < 50 non-whitespace characters or zero readable text fail with `NO_TEXT_LAYER` and user-friendly error *"This PDF contains no selectable text (scanned image). OCR is not supported."*
  - Documents with some empty pages reach `READY` with `emptyPages` array recorded and banner warning: *"N pages had no text and are not searchable"*.
- **LibreOffice headless conversion**:
  - Binary installed at `D:\LibreOffice\program\soffice.exe` (administrative extract to avoid Windows UAC 1603 error).
  - Exact working command:
    `"D:\LibreOffice\program\soffice.exe" -env:UserInstallation=file:///<normalized_temp_profile> --headless --convert-to pdf --outdir <outdir> <docx_path>`
  - Real passage test passed: *"Supplier's aggregate liability under this Agreement shall not exceed AED 100,000."* survived DOCX -> PDF conversion and extracted identically.
  - Original DOCX file bytes are stored in `DocumentFile.content` for subsequent redlining, while converted PDF is stored in `DocumentFile.rendition`.
- **Job Runner & Crash Recovery**:
  - Safe in-process queue using `p-limit(1)` attached to `globalThis` singleton.
  - Next.js `instrumentation.ts` with `experimental.instrumentationHook: true` checks for unfinished documents (`QUEUED`, `CONVERTING`, `EXTRACTING`, `INDEXING`) on startup and automatically requeues them.
- **Gemini via OpenAI SDK (v4.86.1)**:
  - Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`
  - Model: `gemini-flash-latest` (recommended evergreen alias) and `gemini-2.5-flash`.
  - Streaming: Works via standard `for await (const chunk of stream)` reading `delta.content`.
  - Structured output: `response_format: { type: "json_schema", json_schema: { name: "...", strict: true, schema: { ... } } }` succeeds deterministically.
  - Provider limitations:
    - Internal thinking tokens count against `max_tokens`; use `max_tokens >= 300` or omit.
    - Free tier enforces strict per-model request limits (e.g. 20 RPD on fixed aliases) and transient 429/503 bursts. Requires retry logic with exponential backoff and inter-call cooldown.
- **MySQL & Prisma (v6.19.3)**:
  - MySQL database `verbatim` running with utf8mb4.
  - List queries (`GET /api/documents`) strictly use Prisma `select` excluding BLOBs and raw page text.
  - Deletions cascade cleanly across `DocumentFile`, `DocumentText`, and `DocumentPage`.

## Decisions (with reason)
- Next.js 14 App Router + React 18 + Prisma 6 + TypeScript strict: Maximum stability and seamless compatibility with `react-pdf-highlighter-extended` and `pdfjs-dist`.
- `SOFFICE_PATH` configured via `.env` defaulting to `D:\LibreOffice\program\soffice.exe` or `soffice` on PATH.
- Zod schema validation in `src/lib/env.ts` fails fast at startup if required variables are missing; no direct `process.env` in app routes.
- Safe Prisma singleton in `src/lib/db.ts` bound to `globalThis` to prevent connection leaks during Next.js hot reloads.
- SWR client-side polling with 1500ms interval for unfinished documents, refreshing library status dynamically.

## Known problems
- None. All Phase 0 and Phase 1 checks and integration suites pass.

## Legal-Lens Base Code & Migration Strategy
The useful base code from `legal-lens` has been incorporated into `verbatim-main` (`backend/`, `frontend/`, `docker/`, `railway.json`, `render.yaml`). Branding has been updated to Verbatim. Detailed inventory mapped in `docs/LEGAL-LENS-MIGRATION.md`.

- **REMOVE OR REPLACE LATER:**
  - JWT authentication (`backend/routers/auth.py`, `backend/services/auth_service.py`, `frontend/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `auth.ts`)
  - Login/account flows & user registration
  - Multi-tenancy (`organization_id` filters throughout)
  - MongoDB & Motor async driver (replaced by MySQL 8 + Prisma)
  - ChromaDB vector store
  - `sentence-transformers` & PyTorch embedding infrastructure
  - TXT file upload support (assignment strictly limits to PDF and DOCX)
  - Unrelated product features & vanity analytics

- **FIX LATER:**
  - Scanned PDF detection (add threshold check for < 50 chars/page on first 3 pages)
  - Canonical text architecture & character offset ranges (`[startOffset, endOffset]`)
  - Deterministic quote verification (reject/flag hallucinated quotes)
  - Full-document coverage over 100+ page contracts without top-k truncation
  - Streaming NDJSON response behavior
  - Exact citation location with visual bounding boxes via `pdfjs-dist` / `react-pdf-highlighter-extended`
  - Multi-document comparative verification
  - Clause-level structural comparison with alignment confidence scores
  - Real tracked-change DOCX redlining (`w:ins` / `w:del` tags)

- **KEEP/REUSE WHERE USEFUL:**
  - Upload route structure & multipart file handling ideas
  - Async background processing flow & job queue patterns
  - Per-page document text extraction & geometry layout
  - 12 standard clause templates & taxonomy from `clause_library.py`
  - Prompt formulations & refusal patterns from `ai_features.py` and `rag_engine.py`
  - Test suites & fixture contracts
  - Docker Compose orchestration patterns
  - Cloud deployment configurations (`render.yaml`, `railway.json`)
  - Frontend UI components, sidebar layout, and Lucide icon selections

## Next steps
- **Phase 2 (Canonical text and the quote verifier — FR-3)**:
  1. `lib/text/normalize.ts` and `views.ts`: normalisation with offset maps, keep and join views, loose key, LRU cache.
  2. `lib/verify/verify-quote.ts`: min/max length, ellipsis splitting, occurrences (cap 50), page ranges, primary occurrence rule, wrong-document rule.
  3. `lib/verify/locate.ts`: char ranges -> rectangles per page. `GET /api/documents/:id/locate`.
  4. Test fixtures: small synthetic PDF with multi-line clause, hyphenated line break, curly quotes, page break with footer, repeated sentence.

