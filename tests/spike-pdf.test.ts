import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Spike A: PDF.js server-side extraction", () => {
  it("should extract text items with valid geometry and find the target sentence", async () => {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfPath = path.resolve(__dirname, "fixtures/synthetic_spike_a.pdf");
    const data = new Uint8Array(fs.readFileSync(pdfPath));

    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
    });

    const pdfDoc = await loadingTask.promise;
    expect(pdfDoc.numPages).toBe(1);

    const page1 = await pdfDoc.getPage(1);
    const textContent = await page1.getTextContent();
    expect(textContent.items.length).toBeGreaterThan(10);

    // Verify first 10 items have required geometry fields
    const items = textContent.items.slice(0, 10);
    for (const item of items) {
      if ("str" in item) {
        expect(typeof item.str).toBe("string");
        expect(Array.isArray(item.transform)).toBe(true);
        expect(item.transform.length).toBe(6);
        expect(typeof item.width).toBe("number");
        expect(typeof item.height).toBe("number");
        expect(typeof item.hasEOL).toBe("boolean");
      }
    }

    // Target sentence verification
    const targetSentence =
      "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.";

    const matchingItem = textContent.items.find(
      (item) => "str" in item && item.str.includes(targetSentence)
    );

    expect(matchingItem).toBeDefined();
    if (matchingItem && "str" in matchingItem) {
      expect(matchingItem.str).toBe(targetSentence);
      expect(matchingItem.transform[4]).toBe(78); // x origin
      expect(matchingItem.transform[5]).toBe(532); // y origin
      expect(matchingItem.width).toBeGreaterThan(300);
      expect(matchingItem.height).toBe(10);
    }
  });
});
