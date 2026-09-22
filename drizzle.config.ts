/**
 * drizzle-kit configuration.
 *
 * Migrations are GENERATED from server/db/schema.ts and committed to the
 * repository. They are not applied automatically on deploy: `npm run db:migrate`
 * is a deliberate step, because an unattended migration against a production
 * database is how a bad deploy becomes an unrecoverable one.
 */
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Surfaces exactly what will run before it runs.
  verbose: true,
  // Refuses to generate a destructive change without an explicit confirmation.
  strict: true,
});
