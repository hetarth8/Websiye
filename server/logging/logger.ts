/**
 * Structured logging.
 *
 * One JSON object per line on stdout, which is what Netlify's log drain and
 * every log aggregator expect. No dependency: a logger is a function that
 * serialises an object, and pulling in a framework for that would be the kind
 * of unnecessary dependency this project does not want.
 *
 * REDACTION IS THE POINT. Log calls are written by people in a hurry, often by
 * spreading a whole request or row into the context, and that is exactly how
 * passwords and session tokens end up in a log aggregator that more people can
 * read than can read the database. So redaction is not something a caller opts
 * into — every value is walked and anything whose KEY looks sensitive is
 * replaced before it can be serialised.
 */
import { getEnv } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Key fragments that mean "never print this". Matched case-insensitively as a
 * substring, so `password`, `passwordHash` and `SMTP_PASSWORD` all match.
 */
const SENSITIVE_KEY_PATTERN =
  /pass|secret|token|auth|cookie|session|credential|apikey|api_key|signature|salt|hash/i;

/** Depth limit: a cyclic or enormous object must not be able to stall a request. */
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;

export const REDACTED = '[redacted]';

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (depth >= MAX_DEPTH) return '[depth limit]';

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1, seen));
      if (value.length > MAX_ARRAY) items.push(`…${value.length - MAX_ARRAY} more`);
      return items;
    }

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(v, depth + 1, seen);
    }
    return out;
  }

  return String(value);
}

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A logger that stamps every line with the given fields, e.g. a requestId. */
  child(bindings: LogContext): Logger;
}

function write(level: LogLevel, message: string, bindings: LogContext, context?: LogContext): void {
  let threshold: LogLevel = 'info';
  try {
    threshold = getEnv().LOG_LEVEL;
  } catch {
    // Logging must survive a broken configuration — that is precisely when the
    // log is the only way to find out what is wrong.
  }
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;

  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(redact({ ...bindings, ...context }) as LogContext),
  };

  const serialised = JSON.stringify(line);
  if (level === 'error' || level === 'warn') process.stderr.write(`${serialised}\n`);
  else process.stdout.write(`${serialised}\n`);
}

function build(bindings: LogContext): Logger {
  return {
    debug: (m, c) => write('debug', m, bindings, c),
    info: (m, c) => write('info', m, bindings, c),
    warn: (m, c) => write('warn', m, bindings, c),
    error: (m, c) => write('error', m, bindings, c),
    child: (extra) => build({ ...bindings, ...extra }),
  };
}

export const logger: Logger = build({});

/** Exported for the redaction tests, which are the ones that actually matter. */
export const __testing = { redact };
