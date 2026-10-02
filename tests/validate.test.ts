import { describe, it, expect } from "vitest";
import { validateUpload, isZipWithEntry } from "@/lib/ingest/validate";
import { AppError } from "@/lib/errors";

describe("validateUpload", () => {
  // 1. Valid PDF
  it("should accept a valid PDF buffer", () => {
    const validPdfBuffer = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f\ntrailer\n<< /Root 1 0 R >>\nstartxref\n100\n%%EOF"
    );

    const result = validateUpload("contract.pdf", validPdfBuffer);
    expect(result.kind).toBe("pdf");
    expect(result.filename).toBe("contract.pdf");
    expect(result.sizeBytes).toBe(validPdfBuffer.length);
  });

  // 2. Valid DOCX (synthetic ZIP containing word/document.xml)
  it("should accept a valid DOCX buffer containing word/document.xml", () => {
    // Construct minimal zip entry with filename "word/document.xml"
    const entryName = "word/document.xml";
    const entryNameBuf = Buffer.from(entryName, "utf-8");
    const contentBuf = Buffer.from("<w:document/>", "utf-8");

    // Local file header: 30 bytes + name + content
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // compression: 0 (store)
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0, 12); // date
    header.writeUInt32LE(0, 14); // crc32
    header.writeUInt32LE(contentBuf.length, 18); // compressed size
    header.writeUInt32LE(contentBuf.length, 22); // uncompressed size
    header.writeUInt16LE(entryNameBuf.length, 26); // name length
    header.writeUInt16LE(0, 28); // extra field length

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06

    const docxBuffer = Buffer.concat([header, entryNameBuf, contentBuf, eocd]);

    const result = validateUpload("agreement.docx", docxBuffer);
    expect(result.kind).toBe("docx");
    expect(result.filename).toBe("agreement.docx");
  });

  // 3. Reject XLSX (ZIP archive containing xl/workbook.xml instead of word/document.xml)
  it("should reject XLSX with 415 and exact PRD error message", () => {
    const entryName = "xl/workbook.xml";
    const entryNameBuf = Buffer.from(entryName, "utf-8");
    const contentBuf = Buffer.from("<workbook/>", "utf-8");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(contentBuf.length, 18);
    header.writeUInt32LE(contentBuf.length, 22);
    header.writeUInt16LE(entryNameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    const xlsxBuffer = Buffer.concat([header, entryNameBuf, contentBuf]);

    try {
      validateUpload("sheet.xlsx", xlsxBuffer);
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.httpStatus).toBe(415);
      expect(e.code).toBe("UNSUPPORTED_FILE_TYPE");
      expect(e.message).toBe("Only PDF and DOCX files are supported.");
    }
  });

  // 4. Reject TXT
  it("should reject TXT with 415 and exact PRD error message", () => {
    const txtBuffer = Buffer.from("This is a plain text file without PDF or DOCX formatting.");
    try {
      validateUpload("notes.txt", txtBuffer);
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.httpStatus).toBe(415);
      expect(e.code).toBe("UNSUPPORTED_FILE_TYPE");
      expect(e.message).toBe("Only PDF and DOCX files are supported.");
    }
  });

  // 5. Reject renamed EXE (e.g. evil.exe renamed to evil.pdf)
  it("should reject renamed executable with 415 and exact PRD error message", () => {
    // MZ DOS/PE header: 0x4D 0x5A followed by arbitrary bytes
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    try {
      validateUpload("invoice.pdf", exeBuffer);
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.httpStatus).toBe(415);
      expect(e.code).toBe("UNSUPPORTED_FILE_TYPE");
      expect(e.message).toBe("Only PDF and DOCX files are supported.");
    }
  });

  // 6. Reject truncated PDF (starts with %PDF- but cut off before trailer/EOF)
  it("should reject truncated PDF with 400 and exact PRD error message", () => {
    const truncatedBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\n");
    try {
      validateUpload("damaged.pdf", truncatedBuffer);
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.httpStatus).toBe(400);
      expect(e.code).toBe("FILE_CORRUPT");
      expect(e.message).toBe("This file appears to be damaged.");
    }
  });

  // 7. Reject oversize file (> 25MB)
  it("should reject file exceeding MAX_UPLOAD_MB with 413 and exact PRD message", () => {
    // Simulate oversize by creating a buffer with length > 25MB without allocating 26MB of memory
    const fakeOversizeBuffer = {
      length: 26 * 1024 * 1024,
      subarray: () => Buffer.from("%PDF-"),
    } as unknown as Buffer;

    try {
      validateUpload("huge.pdf", fakeOversizeBuffer);
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(AppError);
      expect(e.httpStatus).toBe(413);
      expect(e.code).toBe("FILE_TOO_LARGE");
      expect(e.message).toBe("File exceeds the maximum upload size of 25 MB.");
    }
  });
});
