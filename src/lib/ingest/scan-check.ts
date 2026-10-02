import { RawPageData } from "./extract-pdf";

export interface ScanCheckResult {
  isScanned: boolean;
  reason?: string;
  totalNonWhitespaceChars: number;
}

/**
 * Detects if a document is a scanned image with no usable text layer.
 * Enforces PRD FR-1.4: "A scanned PDF with no selectable text is not saved as a success.
 * The document appears as 'Can't read this file' with the reason ('no selectable text; OCR is not supported')".
 */
export function checkScannedPdf(pages: RawPageData[]): ScanCheckResult {
  let totalNonWhitespaceChars = 0;
  let emptyPageCount = 0;

  for (const page of pages) {
    let pageChars = 0;
    for (const item of page.items) {
      pageChars += item.str.replace(/\s+/g, "").length;
    }
    totalNonWhitespaceChars += pageChars;
    if (pageChars < 5) {
      emptyPageCount++;
    }
  }

  // 1. Total document has virtually no extractable text
  if (totalNonWhitespaceChars < 50) {
    return {
      isScanned: true,
      reason: "no selectable text; OCR is not supported",
      totalNonWhitespaceChars,
    };
  }

  // 2. All pages are empty or near-empty
  if (pages.length >= 3 && emptyPageCount === pages.length) {
    return {
      isScanned: true,
      reason: "no selectable text; OCR is not supported",
      totalNonWhitespaceChars,
    };
  }

  return {
    isScanned: false,
    totalNonWhitespaceChars,
  };
}
