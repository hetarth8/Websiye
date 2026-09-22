/**
 * The database connection.
 *
 * Neon's HTTP driver, not a TCP pool. Serverless functions scale by process:
 * a pool per invocation is a pool per concurrent request, and Postgres runs out
 * of connection slots long before Netlify runs out of containers. The HTTP
 * driver holds no connection between queries, so there is nothing to exhaust.
 *
 * The cost is that each query is its own round trip, which makes N+1 access
 * patterns considerably more expensive here than against a local pool. That is
 * why the repositories join rather than iterate — see server/repositories.
 */
import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';

import { getEnv } from '../config/env.js';
import { logger } from '../logging/logger.js';
import { ServiceUnavailableError } from '../http/errors.js';
import { schema } from './schema.js';

export type Database = NeonHttpDatabase<typeof schema>;

// Cache the connection across invocations. Netlify reuses a warm container for
// consecutive requests, so this turns the second request's setup cost to zero.
let cached: Database | null = null;

export function getDb(connectionString?: string): Database {
  if (cached && !connectionString) return cached;

  const url = connectionString ?? getEnv().DATABASE_URL;
  neonConfig.fetchConnectionCache = true;

  const client = neon(url);
  const db = drizzle(client, { schema, logger: false });

  if (!connectionString) cached = db;
  return db;
}

/**
 * Run a query, tolerating a suspended database.
 *
 * Neon's free tier suspends a project after a few minutes idle and wakes it on
 * the next connection, which can take several seconds and may fail outright
 * first. This is the difference between "the free tier is unusable" and "the
 * first request after a quiet spell is slow", so every entry point that can
 * be the first query of the day goes through here.
 *
 * Only connection-shaped failures are retried. A constraint violation is a
 * real answer and retrying it would just produce the same violation twice.
 */
const COLD_START_PATTERNS = [
  /connection/i,
  /terminat/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /fetch failed/i,
  /socket hang up/i,
];

function looksLikeColdStart(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return COLD_START_PATTERNS.some((p) => p.test(message));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  { attempts = 3, baseDelayMs = 400, label = 'query' }: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!looksLikeColdStart(error) || attempt === attempts) break;

      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn('Database unreachable, retrying', { label, attempt, attempts, delayMs: delay });
      await sleep(delay);
    }
  }

  throw new ServiceUnavailableError(
    'The database is waking up. Please try again in a moment.',
    lastError,
  );
}

/** Liveness probe for GET /api/health. Cheap, and touches no application table. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await withRetry(() => getDb().execute(sql`select 1`), { attempts: 2, label: 'health' });
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

/** Test helper: drops the cached connection so a different URL can be used. */
export function resetDbCache(): void {
  cached = null;
}
