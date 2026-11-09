import { installLogCapture } from './logbuffer';
import { VERSION } from './version';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { openDb } from './db';
import { createApp } from './app';
import { createUser, userCount } from './auth';
import { importLibraries, readLibraryExport } from './libraries';
import { updateSettings } from './settings';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'dicesheet.db');
const WEB_DIR = process.env.WEB_DIR || path.resolve(import.meta.dirname, 'web');

/**
 * Docker bind mounts (./data) are created owned by root. Start as root, make the
 * data folder belong to the unprivileged app user, then drop root for good.
 */
function dropPrivileges() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const uid = Number(process.env.APP_UID ?? 1000), gid = Number(process.env.APP_GID ?? 1000);
  if (uid === 0) return; // explicitly asked to stay root
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const chownTree = (p: string) => {
    try { fs.lchownSync(p, uid, gid); } catch (e: any) { console.warn(`Could not change owner of ${p}: ${e.message}`); }
    if (fs.lstatSync(p).isDirectory()) for (const f of fs.readdirSync(p)) chownTree(path.join(p, f));
  };
  chownTree(DATA_DIR);
  process.setgid(gid);
  process.setuid(uid);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  dropPrivileges();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
  } catch {
    throw new Error(`Can't write to the data folder ${DATA_DIR}. On the host, run: chown -R 1000:1000 <your data folder>`);
  }
  const db = openDb(DB_FILE);

  if (cmd === 'import-libraries') {
    if (!args[0]) throw new Error('Usage: import-libraries <export dir | .tgz | .json>');
    const json = args.includes('--json');
    if (!json) console.log('Reading', args[0]);
    const stats = importLibraries(db, readLibraryExport(args[0]));
    console.log(json ? JSON.stringify(stats) : 'Imported ' + JSON.stringify(stats));
    return;
  }
  if (cmd === 'create-admin') {
    const [username, password] = args;
    const u = await createUser(db, { username, password, isAdmin: true });
    console.log('Created admin', u.username);
    return;
  }
  if (cmd === 'set-registration') {
    console.log(updateSettings(db, { registrationOpen: args[0] === 'open' }));
    return;
  }
  if (cmd === 'backup') {
    // Consistent online copy of the database, safe while the server is running
    const target = args[0] || path.join(DATA_DIR, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log('Backup written to', target);
    return;
  }
  if (cmd && cmd !== 'serve') throw new Error(`Unknown command ${cmd}`);
  installLogCapture(); // the server keeps recent log lines for Admin → Logs

  // Optional bootstrap from env, so a fresh container is never claimable by strangers
  if (userCount(db) === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    await createUser(db, { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, isAdmin: true });
    console.log(`Created admin "${process.env.ADMIN_USERNAME}" from ADMIN_USERNAME/ADMIN_PASSWORD`);
  }
  let setupToken: string | undefined;
  if (userCount(db) === 0) {
    setupToken = crypto.randomBytes(9).toString('base64url');
    console.log('\n================ FIRST RUN ================');
    console.log(`Open the site and create the admin account with setup token:  ${setupToken}`);
    console.log('===========================================\n');
  }

  const app = createApp({ db, setupToken });
  if (fs.existsSync(WEB_DIR)) {
    app.use('/assets/*', serveStatic({ root: path.relative(process.cwd(), WEB_DIR) || '.', onFound: (_p, c) => { c.header('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.use('*', serveStatic({ root: path.relative(process.cwd(), WEB_DIR) || '.' }));
    // SPA fallback
    const index = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
    app.get('*', c => { c.header('Cache-Control', 'no-cache'); return c.html(index); });
  }

  const port = Number(process.env.PORT || 3000);
  serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' });
  console.log(`DiceSheet ${VERSION} listening on :${port}  (data: ${DB_FILE})`);
  // One-time repair for characters affected by the reference-fill bug fixed in 0.1.10
  try {
    const { repairReferenceFills, recompute } = await import('./creatures');
    const fixed = repairReferenceFills(db);
    for (const id of fixed) await recompute(db, id);
    if (fixed.length) console.log(`Repaired ${fixed.length} character(s) whose chosen options had been attached in the wrong place`);
  } catch (e: any) { console.error('Character repair skipped:', e?.message || e); }
}

main().catch(e => { console.error(e?.message || e); process.exit(1); });
