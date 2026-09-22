import { describe, expect, it } from 'vitest';

import {
  getDummyDigest,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  validatePasswordStrength,
  verifyPassword,
} from '../../server/auth/password.js';

describe('hashPassword / verifyPassword', () => {
  it('accepts the correct password', async () => {
    const digest = await hashPassword('a-long-enough-passphrase');
    await expect(verifyPassword('a-long-enough-passphrase', digest)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const digest = await hashPassword('a-long-enough-passphrase');
    await expect(verifyPassword('a-long-enough-passphrasf', digest)).resolves.toBe(false);
  });

  it('never stores the password in the digest', async () => {
    const secret = 'correct-horse-battery-staple';
    const digest = await hashPassword(secret);
    expect(digest).not.toContain(secret);
  });

  it('produces a different digest every time, so equal passwords are not linkable', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-here'), hashPassword('same-password-here')]);
    expect(a).not.toBe(b);
    // …and both still verify.
    await expect(verifyPassword('same-password-here', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password-here', b)).resolves.toBe(true);
  });

  it('encodes its parameters so the cost can be raised later', async () => {
    const digest = await hashPassword('a-long-enough-passphrase');
    expect(digest.split('$')).toHaveLength(6);
    expect(digest.startsWith('scrypt$16384$8$1$')).toBe(true);
  });

  it('treats unicode-equivalent passwords as equal (NFKC)', async () => {
    // Composed vs decomposed "é" — a password manager may supply either form.
    const composed = 'passphrase-café-long';
    const decomposed = 'passphrase-café-long';
    const digest = await hashPassword(composed);
    await expect(verifyPassword(decomposed, digest)).resolves.toBe(true);
  });

  describe('malformed input returns false rather than throwing', () => {
    const bad = [
      ['empty digest', ''],
      ['not a digest', 'hello'],
      ['wrong algorithm', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA=='],
      ['too few fields', 'scrypt$16384$8$1$c2FsdA=='],
      ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
      ['empty hash', 'scrypt$16384$8$1$c2FsdA==$'],
    ] as const;

    for (const [label, digest] of bad) {
      it(label, async () => {
        await expect(verifyPassword('any-password-at-all', digest)).resolves.toBe(false);
      });
    }

    it('refuses an absurd work factor instead of hanging', async () => {
      // 2^30 would take minutes and gigabytes; it must be rejected outright.
      const hostile = `scrypt$${1 << 30}$8$1$c2FsdA==$aGFzaA==`;
      const started = Date.now();
      await expect(verifyPassword('any-password-at-all', hostile)).resolves.toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  it('rejects an over-long password rather than hashing it', async () => {
    await expect(verifyPassword('x'.repeat(10_000), await getDummyDigest())).resolves.toBe(false);
    await expect(hashPassword('x'.repeat(10_000))).rejects.toThrow(/exceeds/i);
  });
});

describe('needsRehash', () => {
  it('is false for a digest at current cost', async () => {
    expect(needsRehash(await hashPassword('a-long-enough-passphrase'))).toBe(false);
  });

  it('is true for a digest at a weaker cost', () => {
    expect(needsRehash('scrypt$1024$8$1$c2FsdA==$aGFzaA==')).toBe(true);
  });

  it('is true for an unparseable digest, so it gets replaced', () => {
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('getDummyDigest', () => {
  it('verifies against nothing, but is a real digest', async () => {
    const digest = await getDummyDigest();
    expect(needsRehash(digest)).toBe(false);
    await expect(verifyPassword('', digest)).resolves.toBe(false);
    await expect(verifyPassword('guess', digest)).resolves.toBe(false);
  });
});

describe('validatePasswordStrength', () => {
  it('accepts a long passphrase with no symbols', () => {
    expect(validatePasswordStrength('correct horse battery staple')).toEqual({ ok: true });
  });

  it('rejects anything shorter than the minimum', () => {
    const result = validatePasswordStrength('x'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.ok).toBe(false);
  });

  it('rejects a well-known password even at full length', () => {
    const result = validatePasswordStrength('ahtconstruction');
    expect(result.ok).toBe(false);
  });

  it('rejects a single repeated character', () => {
    const result = validatePasswordStrength('aaaaaaaaaaaaaaaa');
    expect(result.ok).toBe(false);
  });
});
