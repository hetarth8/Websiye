/**
 * Environment configuration.
 *
 * Parsed once, validated with Zod, then frozen. Two rules drive the design:
 *
 *  1. FAIL FAST, AND SAY WHAT IS MISSING. A serverless function that boots with
 *     a missing DATABASE_URL fails later, deeper, and with a worse message than
 *     one that refuses to start. The error here names every offending variable
 *     at once rather than the first one found.
 *
 *  2. NOT EVERY CONTEXT NEEDS EVERYTHING. The Astro build reads content from the
 *     database and needs DATABASE_URL, but has no use for SESSION_SECRET. So the
 *     base schema covers what is always required and `requireApiEnv()` adds the
 *     variables only the HTTP API needs. Asking for a secret the current process
 *     cannot use is how you end up putting secrets in build environments.
 */
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).catch(fallback);

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  SITE_URL: z.string().url().default('http://localhost:4321'),

  // Postgres. Required everywhere, because both the build and the API read content.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Neon connection string)'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  STORAGE_DRIVER: z.enum(['local', 'netlify-blobs', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(587, 1, 65535),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  ENQUIRY_NOTIFY_TO: z.string().optional(),

  RATE_LIMIT_ENQUIRY_PER_HOUR: int(5, 1, 1000),
  AUTH_MAX_FAILED_ATTEMPTS: int(5, 1, 100),
  AUTH_LOCKOUT_MINUTES: int(15, 1, 1440),
  UPLOAD_MAX_MB: int(10, 1, 100),
  SESSION_TTL_HOURS: int(12, 1, 720),

  IS_NETLIFY: bool(false),
});

const apiSchema = baseSchema.extend({
  // 32 bytes minimum once decoded; the string form is longer. Sessions are
  // database-backed, so this signs the cookie rather than carrying claims.
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters (48 random bytes, base64)'),
});

export type Env = z.infer<typeof baseSchema>;
export type ApiEnv = z.infer<typeof apiSchema>;

function format(error: z.ZodError): string {
  const lines = error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  return `Invalid environment configuration:\n${lines.join('\n')}\n\nSee .env.example for the full list.`;
}

function source(): Record<string, string | undefined> {
  return {
    ...process.env,
    // Netlify injects URL and DEPLOY_PRIME_URL. An explicit SITE_URL wins so a
    // custom domain can be pinned; DEPLOY_PRIME_URL comes before URL so branch
    // previews describe themselves rather than production.
    SITE_URL: process.env.SITE_URL || process.env.DEPLOY_PRIME_URL || process.env.URL,
    IS_NETLIFY: process.env.NETLIFY ? 'true' : 'false',
  };
}

let cachedEnv: Readonly<Env> | null = null;
let cachedApiEnv: Readonly<ApiEnv> | null = null;

/** Configuration available to every context, including the static build. */
export function getEnv(): Readonly<Env> {
  if (cachedEnv) return cachedEnv;
  const parsed = baseSchema.safeParse(source());
  if (!parsed.success) throw new Error(format(parsed.error));
  cachedEnv = Object.freeze(parsed.data);
  return cachedEnv;
}

/** Configuration for the HTTP API, which additionally needs session signing. */
export function requireApiEnv(): Readonly<ApiEnv> {
  if (cachedApiEnv) return cachedApiEnv;
  const parsed = apiSchema.safeParse(source());
  if (!parsed.success) throw new Error(format(parsed.error));
  cachedApiEnv = Object.freeze(parsed.data);
  return cachedApiEnv;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';

/** Test helper: clears the cache so a changed process.env is picked up. */
export function resetEnvCache(): void {
  cachedEnv = null;
  cachedApiEnv = null;
}
