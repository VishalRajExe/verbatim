# Verbatim

> **Enterprise Legal Contract Intelligence Backed by Deterministic Verified Quotes.**  
> Proof over fluency: an AI legal assistant that grounds every claim in exact, verified passages from your agreements with zero hallucinated citations.

---

## Architecture & System Overview

Verbatim is built for attorneys, procurement teams, and legal operations who require strict correctness when analyzing complex agreements. Unlike generic LLM chat wrappers that generate synthetic citation offsets, Verbatim enforces a **server-side verification boundary**:

```mermaid
graph TD
    User([User / Browser]) <-->|HTTP / NDJSON Stream| App[Next.js 14 App Router]
    
    subgraph Frontend [Presentation Layer]
        App --> UI[React 18 Chat & Document Viewer]
        UI --> PDFViewer[react-pdf-highlighter-extended]
        UI --> WordViewer[Native DOCX / PDF Rendition Viewer]
    end

    subgraph Core [Deterministic Core Engine]
        App --> Ingest[Ingestion & Geometry Pipeline]
        App --> Retrieval[Multi-Pass Concept Retrieval]
        App --> Verifier[Deterministic Quote Verifier]
        App --> RedlineEngine[Tracked Changes OOXML Engine]
        App --> CompareEngine[Semantic Comparison & Materiality Engine]
    end

    subgraph Storage [Persistence & Storage]
        Ingest <--> DB[(MySQL 8 via Prisma ORM)]
        App <--> DB
        Ingest <--> LibreOffice[Headless LibreOffice Converter]
    end

    subgraph Intelligence [AI & Reasoning]
        Retrieval --> LLM[Google Gemini / OpenAI Provider]
        Verifier -.->|Only Verified Quotes| LLM
    end
```

---

## Key Workflows

### 1. Document Ingestion Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant API as Ingestion API
    participant Runner as In-Process Job Runner
    participant Parser as PDF / DOCX Parser
    participant DB as MySQL Database

    User->>API: Upload Contract (.pdf or .docx)
    API->>DB: Store Document & Raw File (Status: QUEUED)
    API-->>User: 201 Created (documentId)
    Runner->>DB: Pick next queued job (Concurrency = 1)
    
    alt is DOCX
        Runner->>Parser: Extract authoritative XML text view
        Runner->>DB: Save canonical text & paragraph XML
    else is PDF
        Runner->>Parser: Extract character-level geometry [x, y, w, h]
        Runner->>Parser: Strip page furniture (headers/footers)
        Runner->>Parser: Build canonical text & per-page offset map
        Runner->>DB: Store DocumentPage geometry
    end

    Runner->>DB: Update status to READY (pageCount, canonical text)
```

---

### 2. Retrieval & Verification QA Pipeline

```mermaid
flowchart TD
    Q[User Question] --> QE[Query Expansion & Concept Extraction]
    QE --> Scorer[Multi-Pass Chunk Relevance Scorer]
    Scorer --> Select[Select Top Relevant Chunks + Boundary Context]
    
    Select --> Pacing[Sequential Rate-Paced Extraction]
    Pacing --> ExtractLLM[LLM Candidate Quote Extraction]
    
    ExtractLLM --> Matcher[Server-Side Deterministic Exact Verifier]
    Matcher --> Canonical[(Authoritative Canonical Text)]
    
    Matcher --> Filter{Exact Match Found?}
    Filter -- Yes --> Verified[Verified Quote: Map Page & Bounding Rectangles]
    Filter -- No --> Drop[Mark Unverified: Exclude from Composer]
    
    Verified --> Dedupe[Deduplicate Overlapping Spans]
    Dedupe --> Compose[Compose Answer Using ONLY Verified Quotes]
    Compose --> Stream[Stream NDJSON Tokens & Interactive Citation Chips]
```

---

### 3. Word Tracked Changes / Redlining Pipeline

```mermaid
flowchart TD
    Inst[User Instruction: e.g. 'Change liability cap from AED 100,000 to AED 1,000,000'] --> Intent[Instruction Intent Parser]
    Intent --> Locate[Locate Target Clause in Authoritative DOCX Text]
    
    Locate --> Guard{Invariant I-10 Safety Verification}
    Guard -- Target Missing --> Reject1[Drop Edit: Target not found in document]
    Guard -- Expected Original Mismatch --> Reject2[Precondition Failed: Clause contains different amount]
    Guard -- Ambiguous / Repeated Target --> Reject3[Drop Edit: Ambiguous target across multiple clauses]
    Guard -- Exactly 1 Unique Occurrence --> Valid[Verified Redline Target]
    
    Valid --> OOXML[Generate Tracked Revisions via @adeu/core]
    OOXML --> TagInsDel[Apply minimal &lt;w:ins&gt; and &lt;w:del&gt; with author metadata]
    TagInsDel --> SmokeTest[LibreOffice Headless Smoke Test]
    SmokeTest --> OutputDocx[Ready for Download & Inspection]
```

---

### 4. Contract Comparison Pipeline

```mermaid
flowchart TD
    DocA[Contract A] & DocB[Contract B] --> Align[Structural Clause Segmentation & Alignment]
    Align --> Classify[Semantic Change Classification]
    Classify --> FloorRules{Materiality Floor Engine}
    
    FloorRules -- Liability, Cap, Dates, Amounts --> High[HIGH Materiality]
    FloorRules -- Substantive Clause Revisions --> Med[MEDIUM Materiality]
    FloorRules -- Minor Wording / Stylistic Shifts --> Low[LOW / Cosmetic]
    
    High & Med & Low --> WordDiff[Inline Word-Level Diff &lt;ins&gt; / &lt;del&gt;]
    WordDiff --> UI[Side-by-Side Synchronized Comparison View]
```

---

## Core Architectural Invariants

| ID | Invariant Principle | Implementation Guarantee |
|---|---|---|
| **I-1** | **Server-Side Verification Only** | Only deterministic exact-match server verification can mark a quote `Verified`. Client-side or model assertions are discarded. |
| **I-2** | **No AI-Generated Coordinates** | Page numbers, character offsets, and bounding coordinates are computed deterministically from canonical text views. |
| **I-3** | **Answers Supported by Verified Evidence Only** | Unverified or hallucinated quotes are strictly excluded from the answer composition prompt. |
| **I-4** | **Deterministic Exact Matching** | Quote verification uses Unicode NFKC normalization and character-offset mapping. Semantic similarity is forbidden as final verification. |
| **I-5** | **Honest Coverage Guarantees** | If any section fails or remains unread, the system explicitly reports partial coverage and never claims non-existence. |
| **I-6** | **Unreadable Scanned Document Rejection** | Scanned PDFs lacking an embedded text layer fail ingestion with `NO_TEXT_LAYER`. |
| **I-7** | **Document Attribution Integrity** | Each quote must verify strictly against the document it was attributed to. Cross-document quote leakage is blocked (`WRONG_DOCUMENT`). |
| **I-8** | **Server-Side Secret Isolation** | API keys and credentials exist server-side only; zero secrets are exposed in frontend bundles or logs. |
| **I-9** | **Zero Full-Text Logging** | Complete document text is never dumped to logs; only character counts and sanitized ranges are logged. |
| **I-10** | **DOCX Redline Target Verification** | Redline targets must match authoritatively against genuine DOCX text. Preconditions on existing values are enforced strictly. |

---

## Technology Stack

| Layer | Technologies | Purpose |
|---|---|---|
| **Frontend** | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS | Responsive, accessible UI with real-time streaming and custom design tokens |
| **PDF Rendering** | `pdfjs-dist` (4.4.168), `react-pdf-highlighter-extended` | High-fidelity canvas rendering, viewport coordinate mapping, exact bounding box highlights |
| **Office & DOCX** | `@adeu/core`, LibreOffice Headless CLI | Native OOXML tracked changes (`w:ins`/`w:del`), deterministic DOCX-to-PDF renditions |
| **Backend & APIs** | Next.js Route Handlers, Node.js runtime | Streaming NDJSON endpoints, transactional job processing, concurrency control |
| **Database** | MySQL 8, Prisma ORM 6 | Relational schema for documents, pages, conversations, messages, quotes, and redlines |
| **AI / LLM** | Google Gemini (`gemini-flash-latest`), OpenAI Client SDK | Substantive concept extraction, candidate quote generation, grounded synthesis |
| **Concurrency & Pacing**| `p-limit` | Bounded execution preventing provider rate limits and concurrency bursts |
| **Testing** | Vitest, Node.js Child Process | Deterministic unit tests, integration suites, OOXML inspection, acceptance audit |

---

## Local Setup & Quick Start

### Prerequisites
- **Node.js** 20+ and **npm**
- **MySQL 8** (local installation or Docker)
- **LibreOffice** (`soffice` binary in system PATH)

### 1. Clone the Repository
```bash
git clone https://github.com/VishalRajExe/verbatim.git
cd verbatim
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Configure your credentials in `.env`:
```env
DATABASE_URL="mysql://root:admin@localhost:3306/verbatim"
LLM_API_KEY="your-gemini-or-openai-api-key"
LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
LLM_MODEL="gemini-flash-latest"
LLM_MAX_CONCURRENCY="2"
CHUNK_TOKENS="24000"
SOFFICE_PATH="soffice" # or D:\LibreOffice\program\soffice.exe
PORT=3001
```

### 3. Initialize the Database
```bash
npx prisma db push
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

### 5. Production Build & Start
```bash
npm run build
npm start
```

---

## Testing & Quality Assurance

```bash
# Typecheck (0 errors)
npm run typecheck

# Lint (0 warnings)
npm run lint

# Run deterministic test suite (28 test files)
npm test

# Run generic retrieval regression tests
npx vitest run tests/retrieval-generic.test.ts

# Run redline source-value safety tests
npx vitest run tests/redline-source-value-safety.test.ts
```

---

## Project Structure

```
verbatim/
├── prisma/
│   └── schema.prisma             # Database schema (Documents, Quotes, Redlines, Conversations)
├── src/
│   ├── app/                      # Next.js App Router (Library, Chat, Comparison, Viewers, APIs)
│   ├── components/
│   │   ├── chat/                 # Streaming chat, verified quote pills, NDJSON event consumer
│   │   ├── library/              # Document upload dropzone, status badges, action menus
│   │   ├── viewer/               # PDF highlighter, Word viewer, rendition conversion modal
│   │   └── redline/              # Tracked change diff preview, proposal acceptance UI
│   └── lib/
│       ├── ingest/               # Ingestion pipeline, PDF.js extraction, furniture stripping
│       ├── verify/               # Deterministic exact quote verifier & page coordinate locator
│       ├── qa/                   # Generic multi-pass retrieval, chunker, NDJSON streaming pipeline
│       ├── redline/              # Word tracked changes engine, single-occurrence verifier
│       ├── compare/              # Semantic clause alignment and materiality scoring
│       └── llm/                  # Resilient retry with backoff, concurrency limiter, client singleton
├── tests/                        # Vitest unit, integration, and end-to-end regression suites
└── docs/                         # Architecture specifications, invariants, and implementation logs
```

---

## License

Private and Confidential. Developed for enterprise legal contract intelligence.
