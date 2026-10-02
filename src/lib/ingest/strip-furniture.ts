import { RawPageData, RawTextItem } from "./extract-pdf";

/**
 * Strips running headers, footers, and bare page numbers from page items.
 * Implements Architecture.md section 5:
 * "For each page, take text lines in the top and bottom bands. Normalise digits to '#'.
 * If the same normalised line occurs on at least 40% of pages, mark those items ignored.
 * Also ignore lines that are only a page number ('12', 'Page 12 of 150')."
 */
export function stripPageFurniture(pages: RawPageData[]): RawPageData[] {
  if (pages.length === 0) return pages;

  // Single-page documents don't have repeating headers/footers to compare
  if (pages.length === 1) {
    return pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => !isBarePageNumber(item.str)),
    }));
  }

  // 1. Collect candidate header/footer normalized lines and their page occurrences
  const normalizedLineOccurrences = new Map<string, Set<number>>();

  for (const page of pages) {
    const bottomThreshold = page.height * 0.12; // Bottom 12% in PDF user space
    const topThreshold = page.height * 0.88; // Top 12% in PDF user space

    // Group items into lines based on approximate y coordinate
    const bandItems = page.items.filter(
      (item) => item.transform[5] <= bottomThreshold || item.transform[5] >= topThreshold
    );

    for (const item of bandItems) {
      const trimmed = item.str.trim();
      if (!trimmed) continue;
      const normalized = trimmed.replace(/\d+/g, "#").toLowerCase();
      if (!normalizedLineOccurrences.has(normalized)) {
        normalizedLineOccurrences.set(normalized, new Set());
      }
      normalizedLineOccurrences.get(normalized)!.add(page.pageNo);
    }
  }

  // 2. Identify repeating lines (occurring on >= 40% of pages or >= 2 pages)
  const repeatingThreshold = Math.max(2, Math.ceil(pages.length * 0.4));
  const ignoredPatterns = new Set<string>();

  for (const [pattern, occurrenceSet] of Array.from(normalizedLineOccurrences.entries())) {
    if (occurrenceSet.size >= repeatingThreshold) {
      ignoredPatterns.add(pattern);
    }
  }

  // 3. Filter items per page
  return pages.map((page) => {
    const bottomThreshold = page.height * 0.12;
    const topThreshold = page.height * 0.88;

    const filteredItems = page.items.filter((item) => {
      const trimmed = item.str.trim();
      if (!trimmed) return false;

      // Rule A: Bare page number in header/footer band or anywhere
      if (isBarePageNumber(trimmed)) {
        return false;
      }

      // Rule B: In top/bottom band matching repeating header/footer pattern
      const inBand = item.transform[5] <= bottomThreshold || item.transform[5] >= topThreshold;
      if (inBand) {
        const normalized = trimmed.replace(/\d+/g, "#").toLowerCase();
        if (ignoredPatterns.has(normalized)) {
          return false;
        }
      }

      return true;
    });

    return {
      ...page,
      items: filteredItems,
    };
  });
}

function isBarePageNumber(text: string): boolean {
  const t = text.trim();
  // "12", "- 12 -", "Page 12", "Page 12 of 150", "[12]"
  if (/^\d{1,4}$/.test(t)) return true;
  if (/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(t)) return true;
  if (/^\[\s*\d{1,4}\s*\]$/.test(t)) return true;
  if (/^page\s+\d{1,4}(\s+of\s+\d{1,4})?$/i.test(t)) return true;
  return false;
}
