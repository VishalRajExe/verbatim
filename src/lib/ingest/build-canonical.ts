import { RawPageData, RawTextItem } from "./extract-pdf";

export type CompactItem = [
  start: number, // offset relative to page text
  len: number,   // length of item string
  x: number,     // viewport x (top-left origin)
  y: number,     // viewport y (top-left origin)
  w: number,     // width
  h: number      // height
];

export interface ProcessedPage {
  pageNo: number; // 1-based
  charStart: number; // offset in canonical text
  charEnd: number;   // offset in canonical text
  width: number;
  height: number;
  pageText: string;
  items: CompactItem[];
}

export interface CanonicalResult {
  canonicalText: string;
  pages: ProcessedPage[];
  emptyPages: number[]; // 1-based page numbers with no usable text
  charCount: number;
  tokenEstimate: number;
}

/**
 * Builds canonical text, per-page character offset ranges, and top-left viewport geometry.
 * Implements Architecture.md section 5.
 */
export function buildCanonicalDocument(pages: RawPageData[]): CanonicalResult {
  const processedPages: ProcessedPage[] = [];
  const emptyPages: number[] = [];
  let canonicalText = "";

  for (let i = 0; i < pages.length; i++) {
    const rawPage = pages[i];
    const { pageText, compactItems } = assemblePageText(rawPage);

    // Check for empty page
    const nonWsCount = pageText.replace(/\s+/g, "").length;
    if (nonWsCount < 5) {
      emptyPages.push(rawPage.pageNo);
    }

    const charStart = canonicalText.length;
    canonicalText += pageText;
    const charEnd = canonicalText.length;

    // Pages joined by double newline "\n\n"
    if (i < pages.length - 1) {
      canonicalText += "\n\n";
    }

    processedPages.push({
      pageNo: rawPage.pageNo,
      charStart,
      charEnd,
      width: Math.round(rawPage.width * 10) / 10,
      height: Math.round(rawPage.height * 10) / 10,
      pageText,
      items: compactItems,
    });
  }

  const charCount = canonicalText.length;
  const tokenEstimate = Math.ceil(charCount / 4);

  return {
    canonicalText,
    pages: processedPages,
    emptyPages,
    charCount,
    tokenEstimate,
  };
}

/**
 * Assembles page text from pdf.js items and maps each item to a compact coordinate tuple.
 * Converts PDF coordinates (bottom-left origin) to viewport top-left origin.
 */
function assemblePageText(rawPage: RawPageData): {
  pageText: string;
  compactItems: CompactItem[];
} {
  let pageText = "";
  const compactItems: CompactItem[] = [];

  let prevItem: RawTextItem | null = null;
  let prevRight = 0;

  for (const item of rawPage.items) {
    const str = item.str;
    if (!str) continue;

    // Convert geometry to viewport top-left origin
    const scaleX = item.transform[0] || 1;
    const scaleY = item.transform[3] || 1;
    const tx = item.transform[4] || 0;
    const ty = item.transform[5] || 0;

    const x = Math.max(0, Math.round(tx * 10) / 10);
    // In PDF space, ty is the text baseline measured from bottom of page
    // Viewport top-left y: height - ty - item.height (or scaled height)
    const effectiveHeight = item.height || Math.abs(scaleY) || 10;
    const effectiveWidth = item.width || (str.length * 6 * Math.abs(scaleX));
    const y = Math.max(0, Math.round((rawPage.height - ty - effectiveHeight) * 10) / 10);

    const w = Math.round(effectiveWidth * 10) / 10;
    const h = Math.round(effectiveHeight * 10) / 10;

    // Spacing between items
    if (prevItem) {
      const prevTy = prevItem.transform[5] || 0;
      const verticalDiff = Math.abs(ty - prevTy);

      if (prevItem.hasEOL || verticalDiff > 3) {
        if (!pageText.endsWith("\n")) {
          pageText += "\n";
        }
      } else {
        const gap = tx - prevRight;
        const needsSpace =
          !pageText.endsWith(" ") &&
          !pageText.endsWith("\n") &&
          !str.startsWith(" ") &&
          gap > 1.5; // visible horizontal gap between tokens

        if (needsSpace) {
          pageText += " ";
        }
      }
    }

    const itemStart = pageText.length;
    pageText += str;
    const itemLen = str.length;

    compactItems.push([itemStart, itemLen, x, y, w, h]);

    prevItem = item;
    prevRight = tx + effectiveWidth;
  }

  return {
    pageText,
    compactItems,
  };
}
