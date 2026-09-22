/**
 * The error taxonomy.
 *
 * Every failure the API can produce is one of these. Handlers throw; the router
 * catches once and renders. That is what keeps the response shape identical
 * across endpoints instead of each handler inventing its own error JSON.
 *
 * The important property is `expose`. An AppError carries a message written FOR
 * the caller and is safe to send. Anything else — a driver error, a TypeError,
 * a bug — is not, because its message can carry table names, file paths, or
 * fragments of a connection string. Those are logged in full and answered with
 * a generic message. This is the single mechanism preventing internal leakage,
 * so it lives here rather than being re-decided per route.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'METHOD_NOT_ALLOWED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** One field-level problem. Shaped for a form to consume directly. */
export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];
  /** Safe to send to the caller. False for anything we did not author. */
  readonly expose = true;
  /** Extra context for the log only. NEVER serialised into a response. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { details?: ErrorDetail[]; context?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.context = options.context;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[], message = 'The submitted data is not valid.') {
    super('VALIDATION_ERROR', 422, message, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', 404, `${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super('CONFLICT', 409, message, { details });
  }
}

export class RateLimitError extends AppError {
  /** Seconds until the caller may retry; rendered as a Retry-After header. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many requests. Please try again shortly.') {
    super('RATE_LIMITED', 429, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(limitMb: number) {
    super('PAYLOAD_TOO_LARGE', 413, `That file is too large. The limit is ${limitMb} MB.`);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'That file type is not accepted.') {
    super('UNSUPPORTED_MEDIA_TYPE', 415, message);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(allowed: readonly string[]) {
    super('METHOD_NOT_ALLOWED', 405, 'That method is not allowed on this endpoint.', {
      context: { allowed },
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'The service is temporarily unavailable.', cause?: unknown) {
    super('SERVICE_UNAVAILABLE', 503, message, { cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Turn a Zod error into field-level details.
 *
 * Zod's own message is reused because the schemas are written with messages
 * aimed at the person filling the form, not at a developer.
 */
export function detailsFromZod(error: {
  issues: Array<{ path: Array<string | number>; message: string }>;
}): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '_',
    message: issue.message,
  }));
}
