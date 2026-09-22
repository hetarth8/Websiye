/**
 * Password hashing.
 *
 * scrypt, from Node's own crypto module. Deliberately not argon2 or bcrypt: both
 * are native addons, and a native addon is the single most fragile thing you can
 * put in a serverless bundle — it has to match the platform's ABI, and when it
 * does not, it fails at runtime on the deployed environment rather than in CI.
 * scrypt is memory-hard, is in the Node core, and has no build step.
 *
 * The digest string carries its own parameters:
 *
 *   scrypt$16384$8$1$<salt base64>$<hash base64>
 *
 * which is what allows the cost to be raised later: `needsRehash` spots a digest
 * produced under weaker parameters, and the next successful sign-in silently
 * upgrades it. Without the parameters in the string, raising the cost would mean
 * invalidating every existing password.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * scrypt as a promise, WITH its options argument. `util.promisify` picks the
 * three-argument overload, which has no way to pass the cost parameters — the
 * whole point of encoding them in the digest.
 */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Cost parameters. N is the work factor; memory used is 128 * N * r bytes, so
 * these settings need ~16 MB. `maxmem` must be raised above Node's 32 MB default
 * before N can go higher — omitting it is how a cost increase turns into a
 * confusing runtime error instead of a slower hash.
 */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEM = 64 * 1024 * 1024;
const ALGORITHM = 'scrypt';

/**
 * Length limit. scrypt's cost does not depend on the input length, but accepting
 * an unbounded string still lets a caller post megabytes, so it is capped well
 * above any real passphrase.
 */
export const MAX_PASSWORD_LENGTH = 512;
export const MIN_PASSWORD_LENGTH = 12;

function encode(salt: Buffer, hash: Buffer): string {
  return [ALGORITHM, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join(
    '$',
  );
}

interface Decoded {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function decode(digest: string): Decoded | null {
  const parts = digest.split('$');
  if (parts.length !== 6) return null;
  const [algorithm, n, r, p, salt, hash] = parts;
  if (algorithm !== ALGORITHM) return null;

  const parsed = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(parsed.N) || !Number.isInteger(parsed.r) || !Number.isInteger(parsed.p)) {
    return null;
  }
  // A digest claiming an absurd work factor must not be allowed to turn a login
  // attempt into a denial of service against our own function.
  if (parsed.N > 1 << 20 || parsed.r > 32 || parsed.p > 16) return null;

  try {
    return {
      ...parsed,
      salt: Buffer.from(salt ?? '', 'base64'),
      hash: Buffer.from(hash ?? '', 'base64'),
    };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword requires a non-empty string');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password exceeds ${MAX_PASSWORD_LENGTH} characters`);
  }

  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });

  return encode(salt, hash);
}

/**
 * Verify a password against a digest.
 *
 * Returns false rather than throwing on a malformed digest: a corrupt row must
 * read as "wrong password", never as a 500 that tells an attacker the account
 * exists and is in an unusual state.
 */
export async function verifyPassword(password: string, digest: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof digest !== 'string') return false;
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;

  const decoded = decode(digest);
  if (!decoded || decoded.hash.length === 0) return false;

  try {
    const candidate = await scrypt(password.normalize('NFKC'), decoded.salt, decoded.hash.length, {
      N: decoded.N,
      r: decoded.r,
      p: decoded.p,
      maxmem: MAX_MEM,
    });

    // Lengths are equal by construction above, but timingSafeEqual throws on a
    // mismatch, so the guard stays.
    if (candidate.length !== decoded.hash.length) return false;
    return timingSafeEqual(candidate, decoded.hash);
  } catch {
    return false;
  }
}

/** True when a stored digest was produced under weaker parameters than current. */
export function needsRehash(digest: string): boolean {
  const decoded = decode(digest);
  if (!decoded) return true;
  return decoded.N < PARAMS.N || decoded.r < PARAMS.r || decoded.p < PARAMS.p;
}

/**
 * A digest of a value nobody knows, used when an email does not exist.
 *
 * Sign-in must take the same time whether or not the account is real. Returning
 * early on "no such user" makes the two cases measurably different and turns the
 * login form into an account-existence oracle, so the caller verifies against
 * this instead and discards the result.
 */
let dummyDigest: string | null = null;

export async function getDummyDigest(): Promise<string> {
  if (!dummyDigest) dummyDigest = await hashPassword(randomBytes(32).toString('hex'));
  return dummyDigest;
}

/**
 * Password policy.
 *
 * Length first, because length is what actually resists an offline attack, and
 * a long passphrase should not be rejected for lacking a symbol. The common-
 * password check catches the handful of strings that defeat any length rule.
 */
const COMMON = new Set([
  'password',
  'password123',
  '123456789012',
  'qwertyuiop12',
  'administrator',
  'letmeinplease',
  'ahtconstruction',
  'ahtconstruction1',
]);

export function validatePasswordStrength(password: string): { ok: true } | { ok: false; reason: string } {
  const value = password.normalize('NFKC');

  if (value.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (COMMON.has(value.toLowerCase())) {
    return { ok: false, reason: 'That password is too easy to guess. Choose something else.' };
  }
  if (/^(.)\1+$/.test(value)) {
    return { ok: false, reason: 'That password is a single repeated character.' };
  }
  return { ok: true };
}
