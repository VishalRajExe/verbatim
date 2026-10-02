# Design: Verbatim

Read `PRD.md` section 4 (principles) first. `Rules.md` section 6 says how these tokens are used in code: **no raw hex values in components, only the CSS variables and Tailwind theme names defined here.**

Light theme only (dark theme is out of scope for v1).

---

## 1. Design idea

Verbatim is a tool for people who read contracts for a living. They trust paper, margins, underlines and footnotes. The interface should feel like a well-kept working copy: calm, exact, a little bookish, never "AI product".

**The one memorable thing: two voices.**

| Voice | Typeface | What it carries |
|---|---|---|
| **The document's words** | Serif (Source Serif 4) | Every verified quote, clause text in comparisons, the before and after of a redline |
| **The app's words** | Sans (Public Sans) | Questions, answers, status, buttons, labels, summaries |

At a glance the reader can tell *what the contract says* from *what the app says about it*. This mirrors the product promise (proof over fluency) and costs nothing to build. Everything else stays quiet so this one distinction does the work.

Supporting principles:

1. **Structure is information.** A left rule on a quote means "this came from the document". A rule colour means its verification state. Nothing is decorative.
2. **Verified is earned, never implied.** Only the server's result can produce the green state. Unverified is visibly different, never styled like a warning that looks like a success.
3. **Coverage is always visible.** A partial read is shown on the answer itself, in amber, not hidden in a tooltip.
4. **Quiet surfaces, one loud moment.** The only motion that is not caused by a click is one short highlight pulse when a quote opens in the document.
5. **Plain language** (section 9).

Deliberately avoided: cream background with terracotta accent, near-black with neon accent, identical rounded cards with soft shadows, gradient washes, all-caps eyebrow labels, monospace "data" labels, arrows on buttons.

---

## 2. Colour tokens

Define in `src/app/globals.css` on `:root`. Names follow shadcn/ui conventions where one exists so the generated components work, plus Verbatim-specific tokens.

### Core palette

| Token | Hex | Use |
|---|---|---|
| `--paper` (`--background`) | `#F6F7F9` | App background (cool, slightly blue-grey paper) |
| `--surface` (`--card`, `--popover`) | `#FFFFFF` | Panels, thread, viewer chrome, inputs |
| `--sunken` (`--muted`) | `#EEF0F3` | Inset areas, skeletons, code, table stripes |
| `--line` (`--border`, `--input`) | `#D9DDE3` | Hairline borders and dividers |
| `--line-strong` | `#B9C0CA` | Input hover border, emphasised dividers |
| `--ink` (`--foreground`) | `#17212B` | Primary text (deep blue-black) |
| `--ink-muted` (`--muted-foreground`) | `#596675` | Secondary text, timestamps, helper text |
| `--accent` (`--primary`) | `#1E4E8C` | Primary buttons, links, focus ring, selected state |
| `--accent-hover` | `#173F73` | Hover and pressed |
| `--accent-soft` | `#E6EEF8` | Selected row background, active conversation |
| `--on-accent` (`--primary-foreground`) | `#FFFFFF` | Text on accent |

### Meaning tokens (verification, coverage, significance)

| Token | Hex | Used for |
|---|---|---|
| `--verified` | `#17744A` | Verified quote rule, icon, label; "read all sections" badge |
| `--verified-soft` | `#E7F4EC` | Verified quote header background |
| `--caution` | `#8A4B08` | Unverified quote label; partial coverage badge; Medium significance; warnings |
| `--caution-soft` | `#FCF1DE` | Backgrounds for the above |
| `--caution-line` | `#E3BE82` | Rule and border for the above |
| `--danger` (`--destructive`) | `#B42318` | Errors, failed documents, High significance, Delete |
| `--danger-soft` | `#FDECEA` | Error backgrounds |
| `--slate` | `#4B5D73` | Low significance, neutral tags |
| `--slate-soft` | `#EAEEF3` | Backgrounds for the above |
| `--faint` | `#667085` | Cosmetic significance, disabled labels |
| `--faint-soft` | `#F0F1F3` | Backgrounds for the above |

### Document highlight and diff

| Token | Value | Use |
|---|---|---|
| `--mark` | `rgba(255, 200, 40, 0.45)` | Highlight over the passage in the viewer |
| `--mark-active` | `rgba(255, 200, 40, 0.75)` | The match currently stepped to ("2 of 3") |
| `--mark-ring` | `#C98A00` | 1.5 px outline on the active match |
| `--ins` / `--ins-ink` | `#D5F0E0` / `#0F5A39` | Inserted words in a comparison or redline |
| `--del` / `--del-ink` | `#FBDAD6` / `#8E1C13` | Deleted words (also struck through) |

### Rules for colour

- **Colour never carries meaning alone.** Verified, unverified, partial, and each significance level always have an icon and a text label as well.
- Body text on `--surface` or `--paper` must be at least 4.5:1; large text and UI borders 3:1. Check the pairs above with a contrast checker during Phase 9 and adjust the hex values here (not in components) if one fails.
- No gradients, no colour on large areas. Colour appears on rules, icons, small labels and highlights.
- Tailwind: map the tokens in the theme (v4 `@theme inline`, or v3 `theme.extend.colors`; check the installed version). Class names follow the token names: `bg-paper`, `bg-surface`, `text-ink`, `text-ink-muted`, `border-line`, `text-verified`, `bg-verified-soft`, `border-caution-line`, and so on.

---

## 3. Typography

### Typefaces (load with `next/font/google`, `display: swap`, only the weights listed)

| Role | Family | Weights | CSS variable | Fallback |
|---|---|---|---|---|
| UI and the app's voice | **Public Sans** (variable) | 400, 500, 600 | `--font-ui` | `system-ui, sans-serif` |
| The document's voice, headings, wordmark | **Source Serif 4** (variable, optical size on) | 400, 600; italic 400 | `--font-doc` | `Georgia, serif` |

No monospace face in the product UI. Numbers in tables, page counts and clause numbers use `font-variant-numeric: tabular-nums`. A monospace fallback (`ui-monospace`) is allowed only for error codes shown in a details expander.

### Scale (size / line height, px)

| Name | Size / LH | Font | Use |
|---|---|---|---|
| `text-xs` | 12 / 16 | UI 500 | Badges, helper text, timestamps |
| `text-sm` | 13 / 18 | UI 400 or 500 | Dense lists, table cells, tab labels |
| `text-base` | 14 / 20 | UI 400 | Default interface text, buttons, inputs |
| `text-answer` | 15 / 24 | UI 400 | The streamed answer and user questions |
| `text-quote` | 16 / 26 | **Doc** 400 | Quote text, clause text, redline before/after |
| `text-lg` | 18 / 28 | Doc 600 | Section headings inside a page |
| `text-xl` | 22 / 30 | Doc 600 | Page titles (document name, "Compare versions") |
| `text-display` | 30 / 38 | Doc 600 | Library empty state heading only |

Rules:

- Line length: answer and quote text max **68 characters** (`max-w-[68ch]`); serif may run to 72.
- Serif text gets the more generous line height above; do not tighten it.
- Headings use sentence case, no all caps, no letter-spacing tricks, no single accented word.
- The wordmark "Verbatim" is set in Source Serif 4 semibold at 20 px with `--ink`. No logo graphic. Favicon: a straight double quotation mark in `--accent` on `--paper`.
- Quote text is never truncated with an ellipsis in the card; if long, clamp to 6 lines with a "Show full quote" toggle.
- Do not use bold inside answers for emphasis unless the model is quoting a defined term; the `[Q#]` chips carry the structure.

---

## 4. Layout, spacing, shape

### Grid and spacing

- 4 px base unit. Spacing steps: 4, 8, 12, 16, 24, 32, 48.
- Page max width 1440 px; the document page is full-bleed within that.
- Alignment: **left-aligned everywhere.** Never justify text, never centre body copy. The only centred content is empty-state illustrations and the dropzone message.

### Shape

Different elements have different radii so hierarchy stays readable:

| Element | Radius |
|---|---|
| Quote card | 2 px on the right side, 0 on the left (the rule is flush) |
| Buttons, inputs, selects | 6 px |
| Panels, dialogs, dropzone | 10 px |
| Badges, chips | 4 px (pills are reserved for the `[Q#]` chip: 999 px) |

### Elevation

Borders, not shadows. Panels use a 1 px `--line` border. Only menus, popovers and dialogs have a shadow (`0 8px 24px rgba(23, 33, 43, 0.12)`).

### Breakpoints

| Width | Behaviour |
|---|---|
| ≥ 1280 | Three columns on the document page: rail, chat, viewer |
| 768 to 1279 | Rail collapses to a drawer; viewer opens as a right sheet over the chat (60% width) |
| < 768 | Usable, not polished: one column; viewer is a full-screen sheet with a Close button |

### Screen wireframes

**Library (`/`)**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Verbatim                          Library   Compare versions   Ask across│
├──────────────────────────────────────────────────────────────────────────┤
│  Your contracts                                         [Ask across (2)] │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │      Drop a PDF or DOCX here, or [Choose a file]       Up to 25 MB   │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│  ☐  msa-2024.pdf        PDF · 148 pages · 3.1 MB · 2 min ago   ● Ready   │
│  ☐  nda-v2.docx         DOCX · 12 pages · 80 KB                          │
│                         ●─●─◐─○─○  Reading page 40 of 150      [Cancel?] │
│  ☐  scan.pdf            Can't read this file: no selectable text.        │
│                         OCR isn't supported.                    [Delete] │
└──────────────────────────────────────────────────────────────────────────┘
```
(The meta line is plain text with commas or spacing in the build, not middle-dot strings; the dots above are for the sketch.)

**Document (`/documents/[id]`)**

```
┌───────────────┬────────────────────────────────────┬─────────────────────┐
│ msa-2024.pdf  │  You: What is the liability cap?   │ msa-2024.pdf    ✕   │
│ New chat      │                                    │ Page 14 of 148  − + │
│ ─────────     │  Reading section 3 of 5…           │ ┌─────────────────┐ │
│ ▸ Liability   │                                    │ │ …page…          │ │
│ ▸ Termination │  ┃ Verified · Page 14              │ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ │
│               │  ┃ The aggregate liability of …    │ │ ▓▓▓ highlight ▓ │ │
│               │  ┃ Appears 3 times  ‹ 1 of 3 ›     │ │                 │ │
│               │                                    │ └─────────────────┘ │
│               │  The cap is AED 100,000 [Q1].      │                     │
│               │  ● Read all 5 sections             │                     │
│               │ ┌────────────────────────┐ [Stop]  │                     │
│               │ │ Ask about this contract │         │                     │
└───────────────┴────────────────────────────────────┴─────────────────────┘
```

**Compare (`/compare`)**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Older: nda-v1.docx ▾    Newer: nda-v2.docx ▾             [Compare]       │
│ Summary                                                                  │
│ 7 meaningful changes. The liability cap rose from AED 100,000 to …       │
│ ┌ Filters ─────────┐ ┌ Changes (sort: Most significant ▾) ─────────────┐ │
│ │ Significance      │ │ High    Liability cap raised …        Clause 9 │ │
│ │ ☑ High ☑ Medium   │ │ ┌───────────────────┬───────────────────────┐  │ │
│ │ Type  Category    │ │ │ old text (serif)  │ new text (serif)      │  │ │
│ └───────────────────┘ │ └───────────────────┴───────────────────────┘  │ │
│                       │ Medium  Notice period shortened …              │ │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Components

Build with shadcn/ui primitives (Radix) and `lucide-react` icons at **16 px, stroke 1.75** (20 px for empty states). Icons never appear alone for meaning; they sit next to a label.

### 5.1 Quote card (`components/chat/quote-card.tsx`)

The most important component. A block with a **3 px left rule**, serif text, and a small header row in the UI font.

| State | Rule colour | Header | Icon | Behaviour |
|---|---|---|---|---|
| Verified | `--verified` | "Verified" + document name (multi-doc) + "Page 14" (or "Pages 14 to 15") | `BadgeCheck` | Whole card is a button; Enter or click opens the viewer |
| Verified, repeated | as above | adds "Appears 3 times" and a stepper "‹ 1 of 3 ›" | | Stepper buttons re-locate; the card text does not change |
| Unverified | `--caution-line`, dashed | "Couldn't be verified" | `CircleHelp` | **No open action.** Collapsed by default under one "N quotes couldn't be verified" disclosure; text is shown in `--ink-muted` |
| Unverified, wrong document | as unverified | "Not found in this document" | `CircleHelp` | Same as unverified |
| Active (currently open in viewer) | `--accent` | header unchanged | | `--accent-soft` background |

The card shows the model's exact quote text, never a "cleaned" version. Verified cards do not show the model's `why`.

### 5.2 Citation chip `[Q#]`

Inline pill in the streamed answer: `Q1`, 12 px, UI 600, `--verified` text on `--verified-soft`, 999 px radius, 20 px high. Hover or focus highlights the matching quote card; click opens it. Chips only exist for verified quotes (`Rules.md` I-3). While a marker is still arriving across tokens nothing is rendered, so no half marker flashes.

### 5.3 Coverage badge

Sits under every answer, one per document.

| State | Look | Text |
|---|---|---|
| Complete | `--verified` text, `Check` icon, no fill | "Read all 5 sections" (single doc) or "msa-2024.pdf: read all 5 sections" |
| Complete with unreadable pages | `--caution` | "Read all 5 sections. 2 pages had no text and weren't searched." |
| Partial | `--caution-soft` fill, `--caution-line` border, `TriangleAlert` | "Read 3 of 5 sections. Anything not found may be in the sections that weren't read." |

### 5.4 Stage line and progress

- Chat: one line above the answer, `aria-live="polite"`: "Reading section 2 of 5", then "Checking quotes", then "Writing the answer". `--ink-muted`, with a small determinate bar under it only during the reading stage.
- Library: the **status pipeline** (this *is* a true sequence, so steps are shown): Queued, Converting (DOCX only), Reading pages, Preparing, Ready. Done steps are filled `--accent` dots, current step is a ring, future steps are `--line`. Beside it, the live stage text from the database ("Reading page 40 of 150") and a 4 px progress bar.
- No spinner-only waits longer than 1 second.

### 5.5 Buttons

| Variant | Look | Use |
|---|---|---|
| Primary | `--accent` fill, `--on-accent` text, 36 px high | One per view: Ask, Compare, Apply edits |
| Secondary | `--surface`, 1 px `--line-strong` border | Download, New chat, Choose a file |
| Quiet | no border, `--accent` text | Show full quote, Try again |
| Destructive | `--danger` text, outline; fills only inside the confirm dialog | Delete |
| Stop | `--surface` with `--danger` border and `Square` icon, label "Stop" | Only while an answer is being written; replaces Send in the same spot |

Visible focus on every control: 2 px `--accent` ring with 2 px offset. Labels are verbs, sentence case, no trailing arrows.

### 5.6 Dropzone

Dashed 1.5 px `--line-strong` border, 10 px radius, 96 px high. Idle: "Drop a PDF or DOCX here, or Choose a file" plus "Up to 25 MB". Drag-over: border `--accent`, fill `--accent-soft`. Rejected: inline error beneath (not a toast that disappears): "Only PDF and DOCX files are supported."

### 5.7 Significance and type tags (comparison)

| Level | Colour pair | Icon | Label |
|---|---|---|---|
| High | `--danger` on `--danger-soft` | `AlertOctagon` | High |
| Medium | `--caution` on `--caution-soft` | `TriangleAlert` | Medium |
| Low | `--slate` on `--slate-soft` | `Minus` | Low |
| Cosmetic | `--faint` on `--faint-soft` | `Type` | Cosmetic |

Change types (Added, Removed, Modified, Moved) are plain outlined tags in `--ink-muted`, so colour is saved for significance. A summary with `summarySource = "automatic"` carries a small "Automatic summary" tag in `--ink-muted`.

### 5.8 Redline preview

Each proposed edit is a row with a checkbox, the reason (sans), and a two-line block in the **document voice**: old words in `--del` with strikethrough, new words in `--ins`. Dropped edits are listed under "Edits we couldn't apply" with the reason, in `--caution`.

### 5.9 Viewer chrome

Header: document name, "Page 14 of 148", zoom out / in, Close. Highlights use `--mark`; the match being stepped to uses `--mark-active` and a `--mark-ring` outline. Cross-page quotes highlight on both pages and the header says "Passage continues on page 15".

### 5.10 Document status chips (library)

Ready: `--verified` text, `Check`. Processing: `--accent` text with the pipeline. Warning: `--caution` ("2 pages had no text and aren't searchable"). Failed: `--danger` text on `--danger-soft` row tint with the reason sentence and Delete.

---

## 6. Interaction and motion

- **The one ambient motion:** when a quote opens, the target highlight pulses once (opacity 0.45 to 0.9 to 0.75, 600 ms). Nothing else animates on its own.
- Motion that answers an action is allowed and short: sheet open and close 180 ms ease-out, disclosure expand 150 ms, button press 80 ms. No entrance animations, no hover lifts, no skeleton shimmer (static `--sunken` blocks instead).
- `prefers-reduced-motion: reduce`: remove the pulse (keep `--mark-active` static), make sheets appear without sliding.
- Streaming text appends in place; the scroll position follows the answer only while the user is at the bottom. If they scroll up, show a "Jump to latest" quiet button.
- Stop is reachable by keyboard (focus moves to it when streaming starts; Esc also stops when the composer is focused).

---

## 7. State templates (every data view gets all three, built with the component)

| View | Loading | Empty | Error |
|---|---|---|---|
| Library | Three static row placeholders in `--sunken` | Display heading "Add your first contract", one line "Upload a PDF or DOCX. Then ask it questions and check every answer against the text.", the dropzone | "We couldn't load your contracts. Check your connection and Try again." |
| Conversation list | Two row placeholders | "No questions yet. Ask one below." | "Couldn't load past chats." + Try again |
| Thread | Placeholder bubbles | Suggested starters (static text buttons, not model-generated): "What is the liability cap?", "How can either party terminate?", "Which law governs this contract?" | See below |
| Viewer | Page-sized `--sunken` block, "Opening page 14…" | n/a | "Couldn't open the document. Try again, or download the original." |
| Comparison | Stage text + progress ("Matching clauses", "Summarising 12 changes") | "No meaningful differences. 48 clauses are identical, 3 differ only in wording." | "The comparison failed at 'Summarising changes'. Try again." (automatic summaries are shown instead whenever possible) |
| Redline | Stage text | "Describe a change, for example: make the liability cap mutual." | "We couldn't find the text to change. Name the clause or quote some of its wording." |

**Answer-level states**

| Situation | Presentation |
|---|---|
| Not in the document | Plain sentence, no quotes, coverage badge shown: "I couldn't find a passage that answers this in msa-2024.pdf. All 5 sections were read." |
| Not found, partial read | Amber coverage badge and: "I couldn't find it in the sections I could read (3 of 5). I can't confirm it's absent." |
| Stopped | Muted tag "Stopped" under the partial text; kept on reload |
| Provider error | Inline error block with `--danger` rule: what failed, "Try again" quiet button; any partial text stays, tagged "Incomplete" |
| Rate limited | "The AI service is busy. Retrying in 12 seconds." with a live countdown, then continues or fails to the error block |

---

## 8. Accessibility floor

- Semantic structure: one `h1` per page, landmarks (`header`, `nav`, `main`, `aside` for the viewer).
- Every input has a visible label or an `aria-label`; the composer is a labelled textarea; Enter sends, Shift+Enter adds a line.
- `aria-live="polite"` on the stage line and on the streaming answer region; the quote list announces "3 verified quotes, 1 unverified" once when it appears.
- Quote cards are buttons with an accessible name such as "Open verified quote on page 14".
- Verified, unverified, partial and significance are conveyed by text and icon as well as colour.
- Visible focus ring everywhere (section 5.5); minimum target size 32 px.
- Reduced motion respected (section 6).

---

## 9. Writing rules (interface copy)

1. **Say it to the reviewer, not the developer.** "Reading page 40 of 150", not "EXTRACTING 26%". "Checking quotes", not "Running verification".
2. **Sentence case.** Buttons start with a verb and say what happens: Upload, Ask, Stop, Compare, Download tracked changes, Delete document.
3. **Same name all the way through.** If the button says "Compare", the status says "Comparing" and the result says "Comparison". Quotes are always "quotes", never "citations", "snippets" or "evidence" in the UI. "Verified" is the only word for a found quote.
4. **Errors don't apologise and are never vague.** Say what happened and what to do: "This file appears to be damaged. Export it again from the original program and upload the new copy."
5. **Absence is a statement about reading, not about the contract.** Use "couldn't find", never "there is no", unless coverage is complete, and even then say how many sections were read.
6. **No hype, no emoji, no exclamation marks, no trailing arrows or middle-dot strings.** Put separate facts in separate elements or separate sentences.
7. **Confirmations name the object:** "Delete msa-2024.pdf? Its chats and files are removed too. This can't be undone." Buttons: Delete document / Keep it.

### Fixed strings (use exactly; they come from the PRD acceptance tests)

| Where | String |
|---|---|
| Wrong file type | "Only PDF and DOCX files are supported." |
| Too large | "This file is larger than the 25 MB limit." (limit read from config) |
| Scanned PDF | "Can't read this file. It has no selectable text, and OCR isn't supported." |
| Damaged file | "This file appears to be damaged." |
| Partially blank PDF | "{n} pages had no text and aren't searchable." |
| Unverified group | "{n} quotes couldn't be verified" |
| Unverified quote note | "These words were not found in the document, so they aren't used in the answer." |
| Complete coverage | "Read all {n} sections" |
| Partial coverage | "Read {x} of {n} sections" |
