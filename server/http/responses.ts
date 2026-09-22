/**
 * The response envelope, and the one place errors become HTTP.
 *
 * Every endpoint answers in one of two shapes and no others:
 *
 *   { "success": true,  "data": …, "meta"?: … }
 *   { "success": false, "error": { "code", "message", "details"? } }
 *
 * `renderError` is the only function that turns a thrown value into a response.
 * Routes never format errors themselves, which is what stops the format from
 * drifting endpoint by endpoint, and it is where the decision to hide internal
 * detail in production is enforced.
 */
import { AppError, isAppError, RateLimitError, type ErrorCode, type ErrorDetail } from './errors.js';
import { isProduction } from '../config/env.js';
import { logger } from '../logging/logger.js';

export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  // These responses are user- or query-specific and must never be held by a
  // shared cache. Public GETs override this explicitly via `cacheFor`.
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function ok<T>(data: T, meta?: Record<string, unknown>, headers?: Record<string, string>) {
  return json(200, { success: true, data, ...(meta ? { meta } : {}) }, headers);
}

export function created<T>(data: T, location?: string) {
  return json(201, { success: true, data }, location ? { Location: location } : {});
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export function paginated<T>(items: T[], pagination: Pagination, headers?: Record<string, string>) {
  return json(200, { success: true, data: items, meta: { pagination } }, headers);
}

/**
 * Cache headers for a PUBLIC, unauthenticated GET.
 *
 * `stale-while-revalidate` lets the CDN answer instantly from a slightly stale
 * copy while it refreshes behind the scenes — which matters more than usual
 * here, because the free Neon tier suspends an idle database and the refresh
 * may be the query that has to wake it up.
 */
export function publicCache(seconds: number, staleSeconds = seconds * 10): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`,
  };
}

interface ErrorBody {
  success: false;
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
}

/**
 * Render any thrown value as a response.
 *
 * An AppError was authored for the caller and is sent as written. Anything else
 * is a bug or a driver failure: it is logged in full, and answered with a
 * generic 500 carrying no internal detail. In development the real message is
 * included, because there the only reader is the developer.
 */
export function renderError(error: unknown, requestId?: string): Response {
  if (isAppError(error)) {
    // 4xx is the caller's problem and is noise at error level; 5xx is ours.
    const level = error.status >= 500 ? 'error' : 'warn';
    logger[level](`${error.code}: ${error.message}`, {
      requestId,
      status: error.status,
      ...error.context,
      cause: error.cause instanceof Error ? error.cause.message : undefined,
    });

    const body: ErrorBody = {
      success: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    };

    const headers: Record<string, string> = requestId ? { 'X-Request-Id': requestId } : {};
    if (error instanceof RateLimitError) headers['Retry-After'] = String(error.retryAfterSeconds);
    if (error.code === 'METHOD_NOT_ALLOWED' && Array.isArray(error.context?.allowed)) {
      headers.Allow = (error.context.allowed as string[]).join(', ');
    }
    if (error.code === 'UNAUTHORIZED') headers['WWW-Authenticate'] = 'Cookie realm="admin"';

    return json(error.status, body, headers);
  }

  // Not ours. Log everything, reveal nothing.
  logger.error('Unhandled error', {
    requestId,
    error: error instanceof Error ? error : String(error),
  });

  const body: ErrorBody = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction()
        ? 'Something went wrong. Please try again.'
        : `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
    },
  };

  return json(500, body, requestId ? { 'X-Request-Id': requestId } : {});
}

/** Convenience for the rare case where a route wants to fail without throwing. */
export function fail(error: AppError, requestId?: string): Response {
  return renderError(error, requestId);
}
