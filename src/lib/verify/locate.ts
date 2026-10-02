/**
 * locate() - convert canonical character ranges to page rectangles.
 * Architecture.md SS9.
 *
 * Given a list of [start, end) ranges in canonical text, returns for each
 * overlapping page a list of bounding rectangles that can be passed to
 * react-pdf-highlighter-extended.
 *
 * Steps per Architecture.md SS9:
 *  1. Find overlapping pages via DocumentPage.charStart / charEnd.
 *  2. For each page, find items whose [start, start+len) overlaps the range.
 *  3. Merge adjacent rectangles on the same line (same y baseline within 2px).
 *  4. Return { pageNumber, width, height, rects, boundingRect }.
 */
import { db } from "@/lib/db";
import type { CompactItem } from "@/lib/ingest/build-canonical";

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PageHighlight {
  pageNumber: number;
  width: number;
  height: number;
  rects: Rect[];
  boundingRect: Rect;
}

export interface LocateRange {
  start: number; // canonical text start (inclusive)
  end: number;   // canonical text end (exclusive)
}

function boundingRectOf(rects: Rect[]): Rect {
  return {
    x1: Math.min(...rects.map((r) => r.x1)),
    y1: Math.min(...rects.map((r) => r.y1)),
    x2: Math.max(...rects.map((r) => r.x2)),
    y2: Math.max(...rects.map((r) => r.y2)),
  };
}

/** Merge rectangles that share the same visual line (y1 within 2px of each other). */
function mergeLineRects(rects: Rect[]): Rect[] {
  if (rects.length === 0) return [];

  // Sort by y1 then x1.
  const sorted = [...rects].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const merged: Rect[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const sameLine = Math.abs(r.y1 - current.y1) <= 2;
    if (sameLine) {
      // Extend current rect to encompass r.
      current.x1 = Math.min(current.x1, r.x1);
      current.x2 = Math.max(current.x2, r.x2);
      current.y1 = Math.min(current.y1, r.y1);
      current.y2 = Math.max(current.y2, r.y2);
    } else {
      merged.push(current);
      current = { ...r };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Locate canonical character ranges on document pages.
 * @param documentId Document to look up.
 * @param ranges Array of {start, end} canonical-text ranges to locate.
 * @returns Array of PageHighlight objects (one per page per range).
 */
export async function locate(
  documentId: string,
  ranges: LocateRange[]
): Promise<PageHighlight[]> {
  if (ranges.length === 0) return [];

  const pages = await db.documentPage.findMany({
    where: { documentId },
    select: { pageNo: true, charStart: true, charEnd: true, width: true, height: true, items: true },
    orderBy: { pageNo: "asc" },
  });

  const highlights: PageHighlight[] = [];

  for (const range of ranges) {
    for (const page of pages) {
      // Does this page overlap with the range?
      if (page.charEnd <= range.start || page.charStart >= range.end) continue;

      const pageItems = page.items as CompactItem[];
      const rects: Rect[] = [];

      // Offset of this page's text within canonical text.
      const pageOffset = page.charStart;

      for (const item of pageItems) {
        const [itemStart, itemLen, x, y, w, h] = item;

        // Item's absolute position in canonical text.
        const absStart = pageOffset + itemStart;
        const absEnd = absStart + itemLen;

        // Does this item overlap the range?
        const overlapStart = Math.max(absStart, range.start);
        const overlapEnd = Math.min(absEnd, range.end);
        if (overlapStart >= overlapEnd) continue;

        // Proportional slicing for partial items (first and last item of match).
        let x1 = x;
        let x2 = x + w;

        if (absStart < range.start && itemLen > 0) {
          // First partial item: trim leading characters.
          const trimFraction = (range.start - absStart) / itemLen;
          x1 = x + w * trimFraction;
        }
        if (absEnd > range.end && itemLen > 0) {
          // Last partial item: trim trailing characters.
          const trimFraction = (absEnd - range.end) / itemLen;
          x2 = (x + w) - w * trimFraction;
        }

        rects.push({ x1, y1: y, x2, y2: y + h });
      }

      if (rects.length === 0) continue;

      const merged = mergeLineRects(rects);
      highlights.push({
        pageNumber: page.pageNo,
        width: page.width,
        height: page.height,
        rects: merged,
        boundingRect: boundingRectOf(merged),
      });
    }
  }

  return highlights;
}
