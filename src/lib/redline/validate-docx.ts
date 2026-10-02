/**
 * DOCX Redline Validation (PRD FR-8, Architecture §11).
 *
 * After applying tracked revisions:
 * 1. Unzip DOCX with fflate
 * 2. Count w:ins occurrences
 * 3. Count w:del occurrences
 * 4. Inspect expected revision count
 * 5. Compare untouched paragraph XML with original to confirm no restyling / re-numbering
 * 6. Run LibreOffice headless conversion smoke test to confirm document opens cleanly
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { unzipSync } from "fflate";
import { env } from "@/lib/env";

export interface DocxValidationResult {
  valid: boolean;
  insCount: number;
  delCount: number;
  totalRevisions: number;
  untouchedParagraphsMatched: boolean;
  untouchedParagraphsChecked: number;
  libreOfficeSmokeTestPassed: boolean;
  errors: string[];
}

/**
 * Extracts paragraph XML tags (<w:p ...> ... </w:p>) from word/document.xml.
 */
function extractParagraphs(documentXml: string): string[] {
  const matches = documentXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g);
  return matches ?? [];
}

/**
 * Validates a redlined DOCX buffer against its original buffer.
 */
export async function validateDocxRedline(
  origBuffer: Buffer,
  modifiedBuffer: Buffer,
  expectedEditsCount: number
): Promise<DocxValidationResult> {
  const errors: string[] = [];

  // 1. Unzip both DOCX files
  let origXml: string;
  let modXml: string;

  try {
    const origUnzipped = unzipSync(new Uint8Array(origBuffer));
    const modUnzipped = unzipSync(new Uint8Array(modifiedBuffer));

    if (!origUnzipped["word/document.xml"]) {
      throw new Error("Original DOCX missing word/document.xml");
    }
    if (!modUnzipped["word/document.xml"]) {
      throw new Error("Modified DOCX missing word/document.xml");
    }

    origXml = Buffer.from(origUnzipped["word/document.xml"]).toString("utf-8");
    modXml = Buffer.from(modUnzipped["word/document.xml"]).toString("utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      insCount: 0,
      delCount: 0,
      totalRevisions: 0,
      untouchedParagraphsMatched: false,
      untouchedParagraphsChecked: 0,
      libreOfficeSmokeTestPassed: false,
      errors: [`Failed to unzip or read DOCX: ${msg}`],
    };
  }

  // 2. Count w:ins and w:del tags
  const insMatches = modXml.match(/<w:ins[\s>]/g);
  const delMatches = modXml.match(/<w:del[\s>]/g);
  const insCount = insMatches ? insMatches.length : 0;
  const delCount = delMatches ? delMatches.length : 0;
  const totalRevisions = insCount + delCount;

  if (expectedEditsCount > 0 && totalRevisions === 0) {
    errors.push(
      `Expected tracked revisions in output, but found 0 w:ins and 0 w:del tags.`
    );
  }

  // 3. Compare untouched paragraph XML with original
  const origParagraphs = extractParagraphs(origXml);
  const modParagraphs = extractParagraphs(modXml);

  let untouchedParagraphsChecked = 0;
  let untouchedParagraphsMatched = true;

  if (origParagraphs.length === modParagraphs.length) {
    for (let i = 0; i < modParagraphs.length; i++) {
      const pMod = modParagraphs[i];
      const pOrig = origParagraphs[i];

      // Check if this paragraph was untouched (contains no tracked change tags)
      const hasTrackedChanges =
        pMod.includes("<w:ins") || pMod.includes("<w:del");

      if (!hasTrackedChanges) {
        untouchedParagraphsChecked++;
        if (pMod !== pOrig) {
          untouchedParagraphsMatched = false;
          errors.push(
            `Untouched paragraph ${i} differed between original and modified XML.`
          );
          break;
        }
      }
    }
  } else {
    // If paragraph counts differ, verify at least the matching prefix/suffix paragraphs are intact
    untouchedParagraphsMatched = false;
    errors.push(
      `Paragraph count changed (original: ${origParagraphs.length}, modified: ${modParagraphs.length}).`
    );
  }

  // 4. Run LibreOffice headless conversion smoke test
  let libreOfficeSmokeTestPassed = false;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "redline_validate_"));
  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "soffice_val_profile_"));
  const tempDocxPath = path.join(tempDir, "document_under_test.docx");

  try {
    fs.writeFileSync(tempDocxPath, modifiedBuffer);

    const sofficeBinary = env.SOFFICE_PATH;
    const normalizedProfileUri = "file:///" + tempProfileDir.replace(/\\/g, "/");

    const args = [
      `-env:UserInstallation=${normalizedProfileUri}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      tempDocxPath,
    ];

    const child = spawn(sofficeBinary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("LibreOffice smoke test timed out after 45s"));
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

    if (exitCode === 0) {
      const expectedPdfPath = path.join(tempDir, "document_under_test.pdf");
      if (fs.existsSync(expectedPdfPath) && fs.statSync(expectedPdfPath).size > 0) {
        libreOfficeSmokeTestPassed = true;
      } else {
        errors.push("LibreOffice exited 0 but no valid PDF was produced.");
      }
    } else {
      errors.push(`LibreOffice conversion exited with non-zero code ${exitCode}.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`LibreOffice conversion failed: ${msg}`);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  const valid =
    errors.length === 0 &&
    (expectedEditsCount === 0 || totalRevisions > 0) &&
    libreOfficeSmokeTestPassed;

  return {
    valid,
    insCount,
    delCount,
    totalRevisions,
    untouchedParagraphsMatched,
    untouchedParagraphsChecked,
    libreOfficeSmokeTestPassed,
    errors,
  };
}
