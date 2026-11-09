import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { type DB, q, now, tx } from './db';
import { HttpError, getSettings, validateCharacterLimit, originMatches, envOrigins } from './settings';
import { newId } from '../engine/ids';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

export const SESSION_COOKIE = 'dicesheet_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type User = {
  id: string; username: string; is_admin: number; character_limit: number | null;
  disabled: number; created_at: string; last_login_at: string | null;
};

// ---------- passwords ----------
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, actual);
}
// Used to spend the same time when the username does not exist
let dummyHash: Promise<string> | undefined;

// ---------- validation ----------
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
export function validateUsername(u: unknown): string {
  if (typeof u !== 'string' || !USERNAME_RE.test(u)) {
    throw new HttpError(400, 'Username must be 3-32 characters: letters, numbers, _ . -');
  }
  return u;
}
export function validatePassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 8 || p.length > 200) {
    throw new HttpError(400, 'Password must be 8-200 characters');
  }
  return p;
}

// ---------- users ----------
const USER_FIELDS = 'id, username, is_admin, character_limit, disabled, created_at, last_login_at';

export function getUser(db: DB, id: string): User | undefined {
  return q(db, `SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(id) as User | undefined;
}

export async function createUser(db: DB, opts: { username: unknown, password: unknown, isAdmin?: boolean, characterLimit?: unknown }): Promise<User> {
  const username = validateUsername(opts.username);
  const password = validatePassword(opts.password);
  const limit = opts.characterLimit === undefined || opts.characterLimit === null ? null : validateCharacterLimit(opts.characterLimit);
  if (q(db, 'SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
  const hash = await hashPassword(password);
  const id = newId();
  q(db, 'INSERT INTO users (id, username, password_hash, is_admin, character_limit, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, hash, opts.isAdmin ? 1 : 0, limit, now());
  return getUser(db, id)!;
}

export function userCount(db: DB): number {
  return (q(db, 'SELECT COUNT(*) n FROM users').get() as any).n;
}

export function effectiveCharacterLimit(db: DB, user: User): number {
  return user.character_limit ?? getSettings(db).defaultCharacterLimit;
}

// ---------- sessions ----------
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, c: Context, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  q(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now(), expires.toISOString(), now(), clientIp(c), (c.req.header('user-agent') || '').slice(0, 200));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, path: '/', expires, ...cookieSite(c),
  });
}

export function destroySession(db: DB, c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) q(db, 'DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function destroyUserSessions(db: DB, userId: string) {
  q(db, 'DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function sessionUser(db: DB, c: Context): User | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 100) return;
  const hash = sha256(token);
  const row = q(db, 'SELECT user_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?').get(hash) as any;
  if (!row) return;
  if (row.expires_at < now()) {
    q(db, 'DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return;
  }
  const user = getUser(db, row.user_id);
  if (!user || user.disabled) return;
  // Sliding expiry, written at most once an hour
  if (Date.now() - Date.parse(row.last_seen_at) > 36e5) {
    q(db, 'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(now(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), hash);
  }
  return user;
}

// ---------- request context ----------
export type Env = { Variables: { user?: User } };

/** Attach the logged-in user (if any) and enforce same-origin on state-changing requests. */
export function authMiddleware(db: DB): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      // Browsers can't send a custom header cross-site without a CORS preflight,
      // which this server never approves. Together with SameSite cookies this blocks CSRF.
      if (c.req.header('x-requested-with') !== 'dicesheet') {
        return c.json({ error: 'Missing request header' }, 403);
      }
      const origin = c.req.header('origin');
      if (origin && !sameOrigin(origin, c) && !trustedOrigin(db, origin)) {
        return c.json({ error: `Cross-origin request blocked. If DiceSheet is also served from ${origin}, an admin can add it under Admin → Registration and limits → Other addresses.` }, 403);
      }
    }
    const user = sessionUser(db, c);
    if (user) c.set('user', user);
    await next();
  };
}

export function requireUser(c: Context<Env>): User {
  const u = c.get('user');
  if (!u) throw new HttpError(401, 'Please log in');
  return u;
}

export function requireAdmin(c: Context<Env>): User {
  const u = requireUser(c);
  if (!u.is_admin) throw new HttpError(403, 'Admins only');
  return u;
}

// ---------- login ----------
const attempts = new Map<string, { count: number, first: number }>();
const WINDOW_MS = 15 * 60e3;
const MAX_ATTEMPTS = 10;

function rateLimit(key: string) {
  const t = Date.now();
  const a = attempts.get(key);
  if (!a || t - a.first > WINDOW_MS) {
    if (attempts.size > 50_000) throw new HttpError(429, 'Too many login attempts right now. Try again in a few minutes.');
    attempts.set(key, { count: 1, first: t });
    return;
  }
  a.count++;
  if (a.count > MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}
setInterval(() => {
  const t = Date.now();
  for (const [k, a] of attempts) if (t - a.first > WINDOW_MS) attempts.delete(k);
}, 60e3).unref();

export async function login(db: DB, c: Context, username: unknown, password: unknown): Promise<User> {
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 200) {
    throw new HttpError(400, 'Enter a username and password');
  }
  const ip = clientIp(c);
  rateLimit('ip:' + ip);
  rateLimit('user:' + username.toLowerCase());
  const row = q(db, 'SELECT id, password_hash, disabled FROM users WHERE username = ?').get(username) as any;
  if (!row) {
    await verifyPassword(password, await (dummyHash ??= hashPassword('dummy-password')));
    throw new HttpError(401, 'Wrong username or password');
  }
  if (!(await verifyPassword(password, row.password_hash))) throw new HttpError(401, 'Wrong username or password');
  if (row.disabled) throw new HttpError(403, 'This account is disabled');
  q(db, 'UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), row.id);
  createSession(db, c, row.id);
  return getUser(db, row.id)!;
}

export async function changePassword(db: DB, userId: string, newPassword: unknown) {
  const hash = await hashPassword(validatePassword(newPassword));
  tx(db, () => {
    q(db, 'UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    destroyUserSessions(db, userId);
  });
}

// ---------- proxies ----------
/** TRUST_PROXY=cloudflare uses CF-Connecting-IP; any other truthy value uses X-Forwarded-For. */
export function clientIp(c: Context): string {
  const mode = process.env.TRUST_PROXY;
  const socketIp = (c.env as any)?.incoming?.socket?.remoteAddress || 'unknown';
  // Fall back to the real connection address when the proxy header is missing,
  // e.g. someone opening http://IP:port directly while TRUST_PROXY is set.
  if (mode === 'cloudflare') return c.req.header('cf-connecting-ip') || socketIp;
  if (mode) return (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || socketIp;
  return socketIp;
}

/**
 * SameSite=Lax by default. COOKIE_SAMESITE=none is only needed when a page on a different *site*
 * (not just another address serving DiceSheet itself) calls DiceSheet with the user's login;
 * browsers then require Secure, so it's forced on.
 */
function cookieSite(c: Context): { sameSite: 'Lax' | 'Strict' | 'None', secure: boolean } {
  const mode = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  if (mode === 'none') return { sameSite: 'None', secure: true };
  return { sameSite: mode === 'strict' ? 'Strict' : 'Lax', secure: isSecure(c) };
}

function isSecure(c: Context): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}

/** Listed by an admin (Admin page) or in ALLOWED_ORIGINS. */
const ENV_ORIGINS = envOrigins();
export function trustedOrigin(db: DB, origin: string): boolean {
  return originMatches(origin, ENV_ORIGINS) || originMatches(origin, getSettings(db).allowedOrigins);
}

export function sameOrigin(origin: string, c: Context): boolean {
  try {
    const o = new URL(origin);
    const host = c.req.header('x-forwarded-host') || c.req.header('host');
    return o.host === host;
  } catch {
    return false;
  }
}
