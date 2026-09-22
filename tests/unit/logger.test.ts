/**
 * These are the tests that matter most in this file's neighbourhood.
 *
 * A logger that drops a line is an inconvenience. A logger that prints a
 * password hash or a session token into an aggregator more people can read than
 * can read the database is an incident, so redaction is tested as a property of
 * the logger rather than trusted to callers remembering to omit fields.
 */
import { describe, expect, it } from 'vitest';

import { __testing, REDACTED } from '../../server/logging/logger.js';

const { redact } = __testing;

describe('redaction', () => {
  it('redacts anything whose key looks sensitive, at any depth', () => {
    const input = {
      user: {
        email: 'owner@example.com',
        passwordHash: 'scrypt$16384$8$1$abc$def',
        profile: { apiKey: 'sk_live_123', nested: { sessionToken: 'tok_abc' } },
      },
    };

    const out = redact(input) as Record<string, any>;

    expect(out.user.email).toBe('owner@example.com');
    expect(out.user.passwordHash).toBe(REDACTED);
    expect(out.user.profile.apiKey).toBe(REDACTED);
    expect(out.user.profile.nested.sessionToken).toBe(REDACTED);
  });

  it.each([
    'password',
    'PASSWORD',
    'passwordHash',
    'SMTP_PASSWORD',
    'secret',
    'SESSION_SECRET',
    'token_hash',
    'authorization',
    'Cookie',
    'credential',
    'api_key',
    'salt',
  ])('redacts the key %s', (key) => {
    const out = redact({ [key]: 'sensitive-value' }) as Record<string, unknown>;
    expect(out[key]).toBe(REDACTED);
  });

  it('leaves ordinary fields alone', () => {
    const out = redact({ requestId: 'r1', status: 200, slug: 'atul-arth' }) as Record<string, unknown>;
    expect(out).toEqual({ requestId: 'r1', status: 200, slug: 'atul-arth' });
  });

  it('survives a circular reference instead of throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
    expect((redact(a) as any).self).toBe('[circular]');
  });

  it('stops at a depth limit rather than walking forever', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 40; i += 1) deep = { child: deep };
    expect(() => JSON.stringify(redact(deep))).not.toThrow();
    expect(JSON.stringify(redact(deep))).toContain('[depth limit]');
  });

  it('truncates a very long string', () => {
    const out = redact({ note: 'x'.repeat(5000) }) as Record<string, string>;
    expect(out.note!.length).toBeLessThan(2100);
    expect(out.note!.endsWith('[truncated]')).toBe(true);
  });

  it('caps a very long array', () => {
    const out = redact({ items: Array.from({ length: 500 }, (_, i) => i) }) as Record<string, unknown[]>;
    expect(out.items!.length).toBeLessThanOrEqual(51);
    expect(String(out.items!.at(-1))).toContain('more');
  });

  it('serialises an Error with its stack, since that is the point of logging it', () => {
    const out = redact({ error: new TypeError('boom') }) as any;
    expect(out.error.name).toBe('TypeError');
    expect(out.error.message).toBe('boom');
    expect(typeof out.error.stack).toBe('string');
  });

  it('handles null, undefined and primitives without special-casing at call sites', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(10n)).toBe('10');
  });
});
