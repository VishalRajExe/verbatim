<div align="center">

# Verbatim

**Deterministic Legal Contract Analysis Backed by Verified Quotes**

[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-3776ab.svg)](https://python.org)
[![React](https://img.shields.io/badge/React-18%2F19-61dafb.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed.svg)](docker-compose.yml)

*Deterministic contract analysis where every answer is backed by an exact quote verified against canonical text, with click-to-highlight navigation.*

**[Features](#-features)** · **[Architecture](#-architecture)** · **[Deploy](#-deploy)** · **[API Docs](#-api-endpoints)**

</div>

---

## Why Verbatim?

| Challenge | Verbatim Solution |
|-----------|-------------------|
| AI hallucinations in legal review | **Deterministic server-side quote verification (Invariant I-4)** |
| False negative absence on large 150-page docs | **Windowed full coverage scanning with honest reporting** |
| Unverified quotes cited in chat | **Quarantined unverified quotes; only verified quotes feed answers** |
| Complex contract comparison drift | **Clause-aware alignment recognizing moved/renumbered clauses** |
| Manual redlining errors | **Word-level tracked changes (w:ins/w:del) on valid DOCX targets** |

---

## Quick Start

```bash
cd verbatim-main
cp .env.example .env
docker compose up --build
```

---

## Architecture Overview

Verbatim is designed with strict verification invariants:
1. **Quote Verification:** Substring matching against canonical normalized document text.
2. **Deterministic Coverage:** Full-document inspection ensuring no false negatives on absent clauses.
3. **Citation Highlighting:** Precise geometry mapping linking quotes to viewport rectangles.
