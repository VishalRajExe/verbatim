# Legal-Lens → Verbatim Migration Inventory

This document provides a comprehensive component-by-component audit of the `legal-lens` base code inherited into `verbatim-main`, documenting what each component does, its disposition (**Keep / Adapt / Remove**), the target Verbatim phase for modification, dependencies, and known architectural risks.

---

## Migration Summary

| Status | Count | Description |
|---|---|---|
| **Remove** | 7 | Features violating the Verbatim specification (JWT auth, multi-tenancy, MongoDB, ChromaDB, sentence-transformers, TXT uploads, unverified top-k retrieval) |
| **Adapt** | 12 | Useful backend logic, prompts, and UI structures that will be ported to Next.js App Router / TypeScript strict / Prisma / MySQL |
| **Reuse** | 8 | Domain taxonomies, clause templates, regex patterns, test fixtures, and deployment recipes |

---

## Detailed Component Inventory

### 1. Ingestion & Document Processing

#### Component: Document Upload & File Handling
- **Where it currently lives:** `backend/routers/documents.py`, `backend/services/document_processor.py`
- **What it does:** Receives multipart file uploads, validates extensions (`.pdf`, `.docx`, `.txt`), saves to local disk, triggers background processing.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 1 (Upload, Ingestion, and Library)
- **Dependencies:** FastAPI `UploadFile`, local filesystem storage.
- **Risks & Changes:**
  - *Risk:* Allows `.txt` files. Verbatim specification explicitly rejects all formats except `.pdf` and `.docx`.
  - *Risk:* No magic byte verification (relies on file extension only). Must add MIME/magic byte sniffing via `file-type`.
  - *Change:* Port to Next.js App Router route handler (`src/app/api/documents/route.ts`).
  - *Change:* Enforce 25 MB file size limit and return HTTP 202 with document status immediately.

#### Component: Document Text Extractor
- **Where it currently lives:** `backend/services/document_processor.py`
- **What it does:** Extracts text from PDF using `PyPDF2` and from DOCX using `python-docx`. Produces per-page text dictionaries.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 1 & Phase 2 (Ingestion & Canonical Text)
- **Dependencies:** `PyPDF2`, `python-docx`.
- **Risks & Changes:**
  - *Risk:* `PyPDF2` lacks bounding box / coordinates and fails on complex multi-column layouts.
  - *Risk:* Cannot detect scanned PDFs (README explicitly lists OCR as a missing feature). Scanned PDFs produce 0 characters and silently produce empty chunks.
  - *Change:* Replace with `pdfjs-dist` (v4.4.168) extracting text items with geometric bounding boxes (`transform`, `width`, `height`).
  - *Change:* Implement scanned PDF detection threshold (< 50 non-whitespace characters on average per page across first 3 pages) and reject with descriptive error.
  - *Change:* Convert DOCX to PDF first via headless LibreOffice (`soffice.exe`) to guarantee identical visual layout and page numbering.

#### Component: Text Chunker
- **Where it currently lives:** `backend/services/chunker.py`
- **What it does:** Splits document text into overlapping chunks using token counts / character counts.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 2 (Canonical Text & Chunking)
- **Dependencies:** Python regex / string utilities.
- **Risks & Changes:**
  - *Risk:* Naive chunking breaks mid-sentence or mid-clause across boundaries, corrupting quotation verifiability.
  - *Change:* Rewrite chunker in TypeScript to respect structural boundaries (clauses, sections, paragraphs) and track exact canonical character offset ranges (`[startOffset, endOffset]`) alongside page numbers.

---

### 2. Retrieval, RAG & Verification

#### Component: Vector Store & Embeddings
- **Where it currently lives:** `backend/services/vector_store.py`, `backend/services/embeddings.py`
- **What it does:** Computes dense vector embeddings using local `sentence-transformers` (`all-MiniLM-L6-v2`) and indexes into ChromaDB.
- **Disposition:** **Remove**
- **Verbatim Phase:** Phase 3 & Phase 4 (Chat & Full-Document Coverage)
- **Dependencies:** `chromadb`, `sentence-transformers`, `torch`.
- **Risks & Changes:**
  - *Risk:* Heavy Python/PyTorch dependencies (over 1 GB).
  - *Risk:* Top-k retrieval over vector chunks truncates large documents (100–150 pages), causing hallucinations or missed clauses as warned by the Verbatim assignment.
  - *Change:* Verbatim does not require external vector databases. Rely on Gemini's large context window (1M tokens) with hierarchical map-reduce / section-targeted full coverage, supplemented by canonical text offsets in MySQL.

#### Component: RAG Engine & Prompts
- **Where it currently lives:** `backend/services/rag_engine.py`, `backend/routers/chat.py`
- **What it does:** Builds context from retrieved chunks, queries LLM (Ollama / OpenAI / Anthropic), and constructs answers with page citations.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 3 (Chat with One Document)
- **Dependencies:** OpenAI / Anthropic / Ollama SDKs.
- **Risks & Changes:**
  - *Risk:* Cites sources generically (`[Page X]`) without deterministic quote matching or visual bounding boxes.
  - *Risk:* Hallucinates non-existent quotes when context is ambiguous.
  - *Change:* Port prompt wording and refusal logic to TypeScript using Gemini via OpenAI-compatible endpoint.
  - *Change:* Enforce Verbatim's core invariant: every citation must contain an exact verbatim quote verified against the canonical document text. Unverified quotes must be stripped or flagged.

---

### 3. Legal Intelligence & Comparison

#### Component: Clause Library
- **Where it currently lives:** `backend/services/clause_library.py`, `backend/routers/legal.py`
- **What it does:** Contains 12 standardized contract clause templates (Confidentiality, Indemnification, Limitation of Liability, Termination, Governing Law, etc.) with typical wording, key risk factors, and analysis prompts.
- **Disposition:** **Reuse & Adapt**
- **Verbatim Phase:** Phase 7 (Document Comparison & Categorization)
- **Dependencies:** Static taxonomy data.
- **Risks & Changes:**
  - *Benefit:* High domain value. Gives Verbatim an established legal taxonomy for clause classification.
  - *Change:* Port the Python dictionary taxonomy to a strict TypeScript schema (`src/lib/legal/clauses.ts`).

#### Component: Contract Comparison & AI Features
- **Where it currently lives:** `backend/services/ai_features.py`, `backend/routers/ai.py`
- **What it does:** Compares two documents by extracting sections and prompting LLM for differences, risk assessment, and summary.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 7 & Phase 8 (Comparison & Redlining)
- **Dependencies:** LLM manager.
- **Risks & Changes:**
  - *Risk:* Comparison is purely LLM-generated prose without deterministic sentence/word-level diffing or alignment confidence scores.
  - *Change:* Implement deterministic clause alignment using `diff` / `jsdiff`, compute semantic risk classifications, and generate real tracked-change redlines (`.docx` with w:ins / w:del tags).

---

### 4. Authentication, Tenancy & Database (Baggage to Remove)

#### Component: JWT Authentication & User Management
- **Where it currently lives:** `backend/routers/auth.py`, `backend/services/auth_service.py`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/RegisterPage.tsx`, `frontend/src/lib/auth.ts`
- **What it does:** Registers users, hashes passwords with `bcrypt`, issues JWT access/refresh tokens, enforces permissions (`admin`, `lawyer`, `paralegal`).
- **Disposition:** **Remove**
- **Verbatim Phase:** Phase 0 / Phase 1 cleanup
- **Dependencies:** `python-jose`, `passlib`, `bcrypt`.
- **Risks & Changes:**
  - *Direct Assignment Violation:* The Verbatim assignment states clearly: **"No login/auth required. Open application."**
  - *Action:* Strip authentication middleware and route guards. All operations run directly in a clean single-user workspace.

#### Component: Multi-Tenancy & Organizations
- **Where it currently lives:** Throughout MongoDB collections (`organization_id` filter on all queries)
- **What it does:** Segregates documents and activity by organization.
- **Disposition:** **Remove**
- **Verbatim Phase:** Phase 0 / Phase 1 cleanup
- **Dependencies:** MongoDB query filters.
- **Action:* Remove `organization_id` filters. The single workspace operates globally or per-session.

#### Component: MongoDB Storage Layer
- **Where it currently lives:** `backend/core/database.py`, `docker/mongo-init.js`
- **What it does:** Stores document metadata, user accounts, search history, and activity logs in MongoDB collections.
- **Disposition:** **Remove & Replace**
- **Verbatim Phase:** Phase 0 (Schema migrated) & Phase 1 (Ingestion)
- **Dependencies:** `motor`, `pymongo`, MongoDB server.
- **Action:* Replaced by Prisma ORM over MySQL 8 as mandated by `Architecture.md`. Schema already defined in `prisma/schema.prisma`.

---

### 5. Frontend & UI Shell

#### Component: Frontend Architecture (Vite + React 19)
- **Where it currently lives:** `frontend/`
- **What it does:** Client-side SPA with React Router, Lucide icons, and Tailwind CSS. Contains pages for Dashboard, Documents, DocumentViewer, Chat, ClauseLibrary, AIInsights, Research, and Settings.
- **Disposition:** **Adapt & Migrate into Next.js App Router**
- **Verbatim Phase:** Phase 1 through Phase 5
- **Dependencies:** Vite, React 19, React Router 7, Tailwind 4.
- **Risks & Changes:**
  - *Risk:* React 19 has peer dependency conflicts with `react-pdf-highlighter-extended` and certain testing utilities.
  - *Change:* Our primary UI runtime is Next.js 14 App Router + React 18 in `src/`.
  - *Reuse:* Extract UI patterns, icon selections, document grid layouts, and clause viewing panels from `frontend/src/pages/` into Next.js components (`src/components/`).

#### Component: Document Viewer UI
- **Where it currently lives:** `frontend/src/pages/DocumentViewer.tsx`
- **What it does:** Displays document text per page with a side-by-side search/chat panel.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 5 (Viewer & Highlighting)
- **Dependencies:** Custom HTML/CSS rendering.
- **Risks & Changes:**
  - *Risk:* Renders raw text without PDF canvas or true bounding box highlights.
  - *Change:* Replace with `react-pdf-highlighter-extended` and `pdfjs-dist` to render real PDF pages with interactive visual highlight rectangles corresponding to exact quote locations.

---

### 6. Deployment & Configuration

#### Component: Docker & Deployment Configurations
- **Where it currently lives:** `docker-compose.yml`, `docker/`, `railway.json`, `render.yaml`, `Makefile`
- **What it does:** Container definitions and PaaS blueprints for deployment.
- **Disposition:** **Adapt**
- **Verbatim Phase:** Phase 9 (Deploy & Final Polish)
- **Dependencies:** Docker, Railway, Render.
- **Changes:** Adapt deployment scripts to launch the Next.js production build (`npm run build && npm run start`) with MySQL 8.
