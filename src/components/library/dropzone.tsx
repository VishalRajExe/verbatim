"use client";

import React, { useRef, useState } from "react";
import { UploadCloud, AlertCircle, Loader2 } from "lucide-react";

interface DropzoneProps {
  onUploadSuccess: () => void;
}

export function Dropzone({ onUploadSuccess }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setErrorMessage(null);

    // Client-side quick check for immediate feedback
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") {
      setErrorMessage("Only PDF and DOCX files are supported.");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage("File exceeds the maximum upload size of 25 MB.");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Failed to upload document.");
      } else {
        onUploadSuccess();
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error during upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="w-full space-y-3">
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
          isDragging
            ? "border-accent bg-accent-soft/40"
            : "border-line-strong hover:border-accent hover:bg-accent-soft/20 bg-surface"
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-accent-soft flex items-center justify-center text-accent">
            {isUploading ? (
              <Loader2 className="animate-spin" size={24} />
            ) : (
              <UploadCloud size={24} strokeWidth={1.75} />
            )}
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">
              {isUploading ? "Uploading contract..." : "Drag and drop your contract here, or"}{" "}
              {!isUploading && (
                <span className="text-accent underline underline-offset-2">choose a file</span>
              )}
            </p>
            <p className="text-xs text-ink-muted">Supports PDF and DOCX files up to 25 MB</p>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 bg-danger-soft border border-danger/30 rounded-lg text-danger text-sm"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
