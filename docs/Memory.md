# Memory

Last updated: 2026-10-02 · Current phase: 0 (complete) · Next phase: 1 (Ingestion) · Branch: main · Remote: https://github.com/VishalRajExe/verbatim.git

## Status
| Phase | State | Notes |
|---|---|---|
| 0 Setup and spikes | complete | Next.js skeleton, MySQL migration, health API, PDF.js, LibreOffice, and Gemini spikes verified |
| 1 Ingestion | not started | Next task: upload validation, in-process job queue, DOCX convert, PDF extraction, canonical text |
| 2 Canonical text and verifier | not started | |
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
- **pdfjs-dist (v4.4.168)**:
  - Server-side Node runtime requires importing `pdfjs-dist/legacy/build/pdf.mjs` with `{ data, useSystemFonts: true, disableFontFace: true }`.
  - Next.js config needs `serverExternalPackages: ['pdfjs-dist']`.
  - `page.getTextContent()` exposes text items with `str`, `transform` (`[scaleX, skewY, skewX, scaleY, tx, ty]`), `width`, `height`, and `hasEOL`.
  - Position test passed: verified exact coordinates for target liability sentence on Page 1.
- **LibreOffice headless conversion**:
  - Binary installed at `D:\LibreOffice\program\soffice.exe` (administrative extract to avoid Windows UAC 1603 error).
  - Exact working command:
    `"D:\LibreOffice\program\soffice.exe" -env:UserInstallation=file:///<normalized_temp_profile> --headless --convert-to pdf --outdir <outdir> <docx_path>`
  - Real passage test passed: *"Supplier's aggregate liability under this Agreement shall not exceed AED 100,000."* survived DOCX -> PDF conversion and extracted identically.
- **Gemini via OpenAI SDK (v4.86.1)**:
  - Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`
  - Model: `gemini-flash-latest` (recommended evergreen alias) and `gemini-2.5-flash`.
  - Streaming: Works via standard `for await (const chunk of stream)` reading `delta.content`.
  - Structured output: `response_format: { type: "json_schema", json_schema: { name: "...", strict: true, schema: { ... } } }` succeeds deterministically.
  - Provider limitations:
    - Internal thinking tokens count against `max_tokens`; use `max_tokens >= 300` or omit.
    - Free tier enforces strict per-model request limits (e.g. 20 RPD on fixed aliases) and transient 429/503 bursts. Requires retry logic with exponential backoff and inter-call cooldown.
- **MySQL & Prisma (v6.19.3)**:
  - MySQL database `verbatim` running with utf8mb4. Schema applied with initial migration `20261002073826_init`.
  - `GET /api/health` reports DB & LLM status without leaking secrets.

## Decisions (with reason)
- Next.js 14 App Router + React 18 + Prisma 6 + TypeScript strict: Maximum stability and seamless compatibility with `react-pdf-highlighter-extended` and `pdfjs-dist`.
- `SOFFICE_PATH` configured via `.env` defaulting to `D:\LibreOffice\program\soffice.exe` or `soffice` on PATH.
- Zod schema validation in `src/lib/env.ts` fails fast at startup if required variables are missing; no direct `process.env` in app routes.
- Safe Prisma singleton in `src/lib/db.ts` bound to `globalThis` to prevent connection leaks during Next.js hot reloads.

## Known problems
- None. All Phase 0 checks and spikes pass.

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
- **Phase 1 (Upload, processing, library — FR-1)**:
  1. `lib/ingest/validate.ts`: File validation (extension, MIME, magic bytes, max size).
  2. `POST /api/documents`: Multipart upload handler returning 202.
  3. `lib/jobs/runner.ts`: In-process concurrency-limited job queue with crash recovery on boot.
  4. Ingestion pipeline: DOCX conversion -> PDF extraction -> scan check -> furniture stripping -> canonical text & page geometry indexing.
  5. UI: Library dashboard with upload dropzone and status progression.

