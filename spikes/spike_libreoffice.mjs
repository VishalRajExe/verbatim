import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runLibreOfficeConversion(docxPath, outDir, sofficeBinary = "soffice") {
  // Create an isolated temporary UserInstallation profile
  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "soffice_user_profile_"));
  const normalizedProfileUri = "file:///" + tempProfileDir.replace(/\\/g, "/");

  const args = [
    `-env:UserInstallation=${normalizedProfileUri}`,
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    docxPath,
  ];

  console.log(`Executing: "${sofficeBinary}" ${args.join(" ")}`);

  const conversionPromise = new Promise((resolve, reject) => {
    const child = spawn(sofficeBinary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LibreOffice conversion timed out after 30 seconds"));
    }, 30000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`LibreOffice exited with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  try {
    const result = await conversionPromise;
    return result;
  } finally {
    // Clean up temporary profile
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors on windows if file locks linger briefly
    }
  }
}

async function main() {
  console.log("--- Spike B: LibreOffice DOCX -> PDF Conversion ---");
  const sofficePath = fs.existsSync("D:\\LibreOffice\\program\\soffice.exe")
    ? "D:\\LibreOffice\\program\\soffice.exe"
    : process.env.SOFFICE_PATH || "soffice";

  const docxFixture = path.resolve(__dirname, "../tests/fixtures/sample_contract.docx");
  const outputDir = path.resolve(__dirname, "../tests/fixtures");
  const expectedPdf = path.resolve(outputDir, "sample_contract.pdf");

  console.log(`Input DOCX: ${docxFixture}`);
  console.log(`Soffice Path: ${sofficePath}`);

  if (!fs.existsSync(docxFixture)) {
    console.error("Fixture DOCX not found:", docxFixture);
    process.exit(1);
  }

  const startTime = Date.now();
  await runLibreOfficeConversion(docxFixture, outputDir, sofficePath);
  const duration = Date.now() - startTime;
  console.log(`Conversion succeeded in ${duration}ms`);

  // Verify PDF file was generated
  const convertedPdfPath = path.join(outputDir, path.basename(docxFixture, ".docx") + ".pdf");
  if (!fs.existsSync(convertedPdfPath)) {
    throw new Error(`Expected output PDF not found at ${convertedPdfPath}`);
  }

  const pdfStats = fs.statSync(convertedPdfPath);
  console.log(`Generated PDF Size: ${pdfStats.size} bytes`);

  // Now verify that the target sentence survived DOCX -> PDF conversion
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(convertedPdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

  let allText = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) {
        allText += item.str + (item.hasEOL ? "\n" : " ");
      }
    }
  }

  const targetSentence = "Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.";
  const passageSurvives = allText.includes(targetSentence);

  console.log(`\nExtracted Text length: ${allText.length} chars across ${doc.numPages} page(s)`);
  console.log(`Target passage: "${targetSentence}"`);
  console.log(`Passage survives conversion: ${passageSurvives}`);

  if (!passageSurvives) {
    console.error("Target passage not found in converted PDF text!");
    console.log("Full text preview:\n", allText.slice(0, 500));
    process.exit(1);
  }

  console.log("\n[PASS] Spike B verified successfully.");
}

main().catch((err) => {
  console.error("Spike B Failed:", err);
  process.exit(1);
});
