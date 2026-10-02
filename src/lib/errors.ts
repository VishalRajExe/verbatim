export type ErrorCode =
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "FILE_CORRUPT"
  | "NO_TEXT_LAYER"
  | "CONVERSION_FAILED"
  | "DOC_NOT_FOUND"
  | "DOC_NOT_READY"
  | "TOO_MANY_DOCS"
  | "VALIDATION"
  | "LLM_RATE_LIMITED"
  | "LLM_UNAVAILABLE"
  | "LLM_BAD_OUTPUT"
  | "ABORTED"
  | "INTERNAL";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
