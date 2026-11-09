import { type DB, q } from './db';

export const CHARACTER_LIMIT_MIN = 1;
export const CHARACTER_LIMIT_MAX = 999;

export type Settings = {
  registrationOpen: boolean;
  defaultCharacterLimit: number;
  siteName: string;
  /** Other web addresses the site is served from, e.g. a Cloudflare Worker (see origins below). */
  allowedOrigins: string[];
};

const DEFAULTS: Settings = {
  registrationOpen: false,
  defaultCharacterLimit: 5,
  siteName: 'DiceSheet',
  allowedOrigins: [],
};

export function getSettings(db: DB): Settings {
  const rows = q(db, 'SELECT key, value FROM settings').all() as { key: string, value: string }[];
  const s: any = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) s[r.key] = JSON.parse(r.value);
  return s;
}

export function updateSettings(db: DB, patch: Partial<Settings>): Settings {
  const clean: Partial<Settings> = {};
  if (patch.registrationOpen !== undefined) {
    if (typeof patch.registrationOpen !== 'boolean') throw new HttpError(400, 'registrationOpen must be true or false');
    clean.registrationOpen = patch.registrationOpen;
  }
  if (patch.defaultCharacterLimit !== undefined) {
    clean.defaultCharacterLimit = validateCharacterLimit(patch.defaultCharacterLimit);
  }
  if (patch.siteName !== undefined) {
    if (typeof patch.siteName !== 'string' || !patch.siteName.trim() || patch.siteName.length > 60) {
      throw new HttpError(400, 'Site name must be 1-60 characters');
    }
    clean.siteName = patch.siteName.trim();
  }
  if (patch.allowedOrigins !== undefined) clean.allowedOrigins = validateOrigins(patch.allowedOrigins);
  for (const [k, v] of Object.entries(clean)) {
    q(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(k, JSON.stringify(v));
  }
  return getSettings(db);
}

// ---------- extra trusted origins ----------
// DiceSheet only accepts sign-ins and changes from the address it's served on. When the site is
// also served through another address (a Cloudflare Worker, a second domain), that address must
// be listed. Entries are origins ("https://dicesheet.me.workers.dev"); a leading "*." matches
// exactly one extra label ("https://*.me.workers.dev"), never a whole public suffix.
const ORIGIN_RE = /^(https?):\/\/(\*\.)?([a-z0-9-]+(\.[a-z0-9-]+)*)(:\d{1,5})?$/;
const MAX_ORIGINS = 20;
const SHARED_HOSTS = ['workers.dev', 'pages.dev', 'trycloudflare.com', 'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com',
  'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'web.app', 'firebaseapp.com', 'onrender.com', 'fly.dev', 'glitch.me', 'repl.co',
  'co.uk', 'com.au', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.mx'];

export function normalizeOrigin(raw: string): string {
  return raw.trim().toLowerCase().replace(/\/+$/, '');
}

export function validateOrigins(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : null;
  if (!list) throw new HttpError(400, 'Allowed addresses must be a list');
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const o = normalizeOrigin(item);
    const m = ORIGIN_RE.exec(o);
    if (!m) throw new HttpError(400, `"${item}" isn't a web address like https://dicesheet.example.workers.dev (no path)`);
    // A wildcard must sit under a domain one owner controls: not a bare TLD ("*.com") and not a
    // shared host where anyone can make subdomains ("*.workers.dev"; use "*.yourname.workers.dev")
    if (m[2] && (m[3].split('.').length < 2 || SHARED_HOSTS.includes(m[3]))) throw new HttpError(400, `"${item}" is too broad: anyone can create addresses there. Use your own, e.g. https://*.yourname.workers.dev`);
    if (!out.includes(o)) out.push(o);
  }
  if (out.length > MAX_ORIGINS) throw new HttpError(400, `Up to ${MAX_ORIGINS} addresses`);
  return out;
}

/** Does an Origin header match one of these entries? */
export function originMatches(origin: string, entries: string[]): boolean {
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  const want = `${o.protocol}//${o.host}`.toLowerCase();
  for (const e of entries) {
    if (e === want) return true;
    const m = ORIGIN_RE.exec(e);
    if (!m || !m[2]) continue;
    const [scheme, , rest, , port = ''] = [m[1], m[2], m[3], m[4], m[5]];
    if (`${o.protocol}` !== `${scheme}:` || `${o.port ? ':' + o.port : ''}` !== port) continue;
    const host = o.hostname.toLowerCase();
    if (host.endsWith('.' + rest) && !host.slice(0, -rest.length - 1).includes('.')) return true;
  }
  return false;
}

/** Addresses from the ALLOWED_ORIGINS environment variable (comma or space separated). */
export function envOrigins(): string[] {
  try { return validateOrigins(process.env.ALLOWED_ORIGINS || ''); } catch (e: any) { console.error('ALLOWED_ORIGINS ignored:', e.message); return []; }
}

/** Character limits are whole numbers from 1 to 999. There is deliberately no "unlimited". */
export function validateCharacterLimit(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < CHARACTER_LIMIT_MIN || v > CHARACTER_LIMIT_MAX) {
    throw new HttpError(400, `Character limit must be a whole number from ${CHARACTER_LIMIT_MIN} to ${CHARACTER_LIMIT_MAX}`);
  }
  return v;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
