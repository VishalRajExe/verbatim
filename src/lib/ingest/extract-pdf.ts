export interface RawTextItem {
  str: string;
  transform: number[]; // [scaleX, skewY, skewX, scaleY, tx, ty]
  width: number;
  height: number;
  hasEOL: boolean;
}

export interface RawPageData {
  pageNo: number; // 1-based
  width: number;
  height: number;
  items: RawTextItem[];
}

export interface ExtractedPdf {
  pageCount: number;
  pages: RawPageData[];
}

export type ExtractionProgressCallback = (
  currentPage: number,
  totalPages: number
) => Promise<void> | void;

/**
 * Extracts text items and page geometry from a PDF buffer using pdfjs-dist server-side.
 */
export async function extractPdf(
  pdfBuffer: Buffer,
  onProgress?: ExtractionProgressCallback
): Promise<ExtractedPdf> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(pdfBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;
  const pages: RawPageData[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdfDoc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const items: RawTextItem[] = [];
    for (const item of textContent.items) {
      if ("str" in item && typeof item.str === "string") {
        items.push({
          str: item.str,
          transform: Array.from(item.transform),
          width: item.width,
          height: item.height,
          hasEOL: Boolean(item.hasEOL),
        });
      }
    }

    pages.push({
      pageNo: p,
      width: viewport.width,
      height: viewport.height,
      items,
    });

    if (onProgress) {
      await onProgress(p, pageCount);
    }
  }

  return { pageCount, pages };
}
