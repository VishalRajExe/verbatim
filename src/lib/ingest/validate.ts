import path from "path";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";

export interface ValidatedFile {
  filename: string;
  kind: "pdf" | "docx";
  buffer: Buffer;
  sizeBytes: number;
}

/**
 * Checks if a buffer represents a valid ZIP archive containing a specific entry.
 * DOCX files are OpenXML ZIP packages that must contain "word/document.xml".
 */
export function isZipWithEntry(buffer: Buffer, entryPath: string): boolean {
  if (buffer.length < 30) return false;

  // Check initial magic bytes: PK\x03\x04 or PK\x05\x06 (empty)
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  if (![0x03, 0x05, 0x07].includes(buffer[2])) return false;

  // Search through Local File Headers (0x04034b50)
  let offset = 0;
  const targetBuf = Buffer.from(entryPath, "utf-8");

  while (offset + 30 <= buffer.length) {
    // Look for PK\x03\x04
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x03 &&
      buffer[offset + 3] === 0x04
    ) {
      const fileNameLen = buffer.readUInt16LE(offset + 26);
      const extraFieldLen = buffer.readUInt16LE(offset + 28);
      const fileNameStart = offset + 30;
      const fileNameEnd = fileNameStart + fileNameLen;

      if (fileNameEnd <= buffer.length) {
        const entryName = buffer.subarray(fileNameStart, fileNameEnd).toString("utf-8");
        if (entryName === entryPath || entryName.toLowerCase() === entryPath.toLowerCase()) {
          return true;
        }
      }

      // Advance past this local header + name + extra + jump ahead safely
      offset = fileNameEnd + extraFieldLen;
      continue;
    }

    // Look for Central Directory Header PK\x01\x02
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x01 &&
      buffer[offset + 3] === 0x02
    ) {
      if (offset + 46 > buffer.length) break;
      const fileNameLen = buffer.readUInt16LE(offset + 28);
      const extraFieldLen = buffer.readUInt16LE(offset + 30);
      const commentLen = buffer.readUInt16LE(offset + 32);
      const fileNameStart = offset + 46;
      const fileNameEnd = fileNameStart + fileNameLen;

      if (fileNameEnd <= buffer.length) {
        const entryName = buffer.subarray(fileNameStart, fileNameEnd).toString("utf-8");
        if (entryName === entryPath || entryName.toLowerCase() === entryPath.toLowerCase()) {
          return true;
        }
      }

      offset = fileNameEnd + extraFieldLen + commentLen;
      continue;
    }

    offset++;
  }

  // Fallback check: if the exact entry name exists as a substring in the ZIP
  return buffer.includes(targetBuf);
}

/**
 * Validates an uploaded document's extension, MIME, magic bytes, size, and structural integrity.
 * Enforces PRD FR-1.1, FR-1.2, and FR-1.8 requirements.
 */
export function validateUpload(
  filename: string,
  buffer: Buffer,
  mimeType?: string
): ValidatedFile {
  const maxMb = env.MAX_UPLOAD_MB;
  const maxBytes = maxMb * 1024 * 1024;

  // 1. Size check (FR-1.2)
  if (buffer.length > maxBytes) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `File exceeds the maximum upload size of ${maxMb} MB.`,
      413
    );
  }

  if (buffer.length === 0) {
    throw new AppError(
      "FILE_CORRUPT",
      "This file appears to be damaged.",
      400
    );
  }

  const ext = path.extname(filename).toLowerCase();

  // 2. Extension check (FR-1.1)
  if (ext !== ".pdf" && ext !== ".docx") {
    throw new AppError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PDF and DOCX files are supported.",
      415
    );
  }

  // 3. Renamed executable check (FR-1.1: MZ header for PE/EXE or ELF/Mach-O)
  if (
    (buffer[0] === 0x4d && buffer[1] === 0x5a) || // MZ (Windows / DOS executable)
    (buffer[0] === 0x7f && buffer.subarray(1, 4).toString() === "ELF") // ELF (Linux executable)
  ) {
    throw new AppError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PDF and DOCX files are supported.",
      415
    );
  }

  // 4. PDF validation
  if (ext === ".pdf") {
    // Magic bytes: PDF must start with '%PDF-'
    const header = buffer.subarray(0, 5).toString("utf-8");
    if (header !== "%PDF-") {
      throw new AppError(
        "UNSUPPORTED_FILE_TYPE",
        "Only PDF and DOCX files are supported.",
        415
      );
    }

    // Minimum plausible PDF size (header + catalog + root + xref/trailer is at least ~64 bytes)
    if (buffer.length < 64) {
      throw new AppError(
        "FILE_CORRUPT",
        "This file appears to be damaged.",
        400
      );
    }

    // Truncated/damaged PDF check: a valid PDF must contain '%%EOF' or 'trailer' near the end or at least an xref/stream
    const trailerWindow = buffer.subarray(Math.max(0, buffer.length - 1024)).toString("utf-8");
    if (!trailerWindow.includes("%%EOF") && !trailerWindow.includes("trailer") && !trailerWindow.includes("startxref")) {
      throw new AppError(
        "FILE_CORRUPT",
        "This file appears to be damaged.",
        400
      );
    }

    return {
      filename,
      kind: "pdf",
      buffer,
      sizeBytes: buffer.length,
    };
  }

  // 5. DOCX validation
  if (ext === ".docx") {
    // Magic bytes: DOCX must be a ZIP archive
    if (buffer.length < 30 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new AppError(
        "UNSUPPORTED_FILE_TYPE",
        "Only PDF and DOCX files are supported.",
        415
      );
    }

    // Must be a valid Word document package containing "word/document.xml" (not an XLSX or generic zip)
    const hasWordDoc = isZipWithEntry(buffer, "word/document.xml");
    if (!hasWordDoc) {
      throw new AppError(
        "UNSUPPORTED_FILE_TYPE",
        "Only PDF and DOCX files are supported.",
        415
      );
    }

    return {
      filename,
      kind: "docx",
      buffer,
      sizeBytes: buffer.length,
    };
  }

  throw new AppError(
    "UNSUPPORTED_FILE_TYPE",
    "Only PDF and DOCX files are supported.",
    415
  );
}
