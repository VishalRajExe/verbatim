import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { DocumentObject, RedlineEngine, extractTextFromBuffer } from "@adeu/core";
import { env } from "@/lib/env";

describe("Phase 8 Spike: @adeu/core DOCX Tracked Changes", () => {
  it("loads synthetic DOCX, extracts text view, applies tracked edit, and validates with LibreOffice", async () => {
    const docxPath = path.resolve(process.cwd(), "tests/fixtures/synthetic_spike_b.docx");
    expect(fs.existsSync(docxPath)).toBe(true);

    const origBuffer = fs.readFileSync(docxPath);

    // 1. Extract text view
    const textView = await extractTextFromBuffer(origBuffer, false);
    expect(textView).toBeTruthy();
    expect(textView).toContain("Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.");

    // 2. Load document object and redline engine
    const doc = await DocumentObject.load(origBuffer);
    const engine = new RedlineEngine(doc, "Verbatim AI");

    // 3. Apply tracked change edit
    const targetText = "Supplier's aggregate liability";
    const newText = "The aggregate liability of either party";

    const report = engine.process_batch([
      {
        type: "modify",
        target_text: targetText,
        new_text: newText,
        match_mode: "strict",
      },
    ]);

    // 4. Save modified docx
    const modifiedBuffer = await doc.save();
    expect(modifiedBuffer).toBeInstanceOf(Uint8Array);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "redline_spike_"));
    const modifiedDocxPath = path.join(tempDir, "contract_redlined.docx");
    fs.writeFileSync(modifiedDocxPath, Buffer.from(modifiedBuffer));

    // 5. Inspect OOXML inside the modified docx
    // Using fflate or adm-zip/unzip to verify w:ins and w:del exist
    const { unzipSync } = await import("fflate");
    const unzipped = unzipSync(new Uint8Array(fs.readFileSync(modifiedDocxPath)));
    const documentXmlBytes = unzipped["word/document.xml"];
    expect(documentXmlBytes).toBeDefined();

    const documentXml = Buffer.from(documentXmlBytes).toString("utf-8");
    expect(documentXml).toContain("w:ins");
    expect(documentXml).toContain("w:del");
    expect(documentXml).toContain('w:author="Verbatim AI"');
    expect(documentXml).toContain("<w:delText>Supplier's</w:delText>");
    expect(documentXml).toContain("The");
    expect(documentXml).toContain("of either party");

    // 6. Smoke test: confirm LibreOffice opens and converts the file cleanly to PDF
    const sofficeBinary = env.SOFFICE_PATH;
    const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "soffice_redline_profile_"));
    const normalizedProfileUri = "file:///" + tempProfileDir.replace(/\\/g, "/");

    const args = [
      `-env:UserInstallation=${normalizedProfileUri}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      modifiedDocxPath,
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

    const pdfPath = path.join(tempDir, "contract_redlined.pdf");
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(1000);

    // Clean up
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 60000);
});
