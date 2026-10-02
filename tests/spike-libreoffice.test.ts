import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { env } from "@/lib/env";

describe("Spike B: LibreOffice DOCX -> PDF conversion", () => {
  it("should convert DOCX to PDF headlessly and preserve the liability passage", async () => {
    const sofficeBinary = env.SOFFICE_PATH;
    const docxPath = path.resolve(__dirname, "fixtures/synthetic_spike_b.docx");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "soffice_out_"));

    expect(fs.existsSync(docxPath)).toBe(true);

    const tempProfileDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "soffice_test_profile_")
    );
    const normalizedProfileUri =
      "file:///" + tempProfileDir.replace(/\\/g, "/");

    const args = [
      `-env:UserInstallation=${normalizedProfileUri}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      docxPath,
    ];

    const child = spawn(sofficeBinary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("LibreOffice conversion timeout"));
      }, 45000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 0);
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    expect(exitCode).toBe(0);

    const pdfPath = path.join(
      outDir,
      path.basename(docxPath, ".docx") + ".pdf"
    );
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(1000);

    // Extract text from the converted PDF using pdfjs-dist
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfDoc = await pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;

    let fullText = "";
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) {
          fullText += item.str + (item.hasEOL ? "\n" : " ");
        }
      }
    }

    const targetSentence =
      "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.";
    expect(fullText).toContain(targetSentence);

    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 45000);
});
