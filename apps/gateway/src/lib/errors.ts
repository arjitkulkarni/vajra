export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }

  static badRequest(code: string, message?: string, details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(code = "unauthorized", message?: string) {
    return new ApiError(401, code, message);
  }
  static forbidden(code = "forbidden", message?: string, details?: unknown) {
    return new ApiError(403, code, message, details);
  }
  static notFound(code = "not_found", message?: string) {
    return new ApiError(404, code, message);
  }
  static conflict(code: string, message?: string) {
    return new ApiError(409, code, message);
  }
  static unavailable(code: string, message?: string, details?: unknown) {
    return new ApiError(503, code, message, details);
  }

  /** Attach structured details (e.g. "these bytes are already CAD-TURBINE-V4 v4"). */
  withDetails(details: unknown): ApiError {
    return new ApiError(this.status, this.code, this.message, details);
  }
}
