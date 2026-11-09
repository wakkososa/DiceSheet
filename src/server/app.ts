import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { type DB, q, now, tx } from './db';
import { HttpError, getSettings, updateSettings, validateCharacterLimit } from './settings';
import {
  type Env, authMiddleware, sameOrigin, trustedOrigin, clientIp, requireUser, requireAdmin, login, createSession, destroySession, createUser,
  userCount, changePassword, verifyPassword, getUser, destroyUserSessions, effectiveCharacterLimit,
} from './auth';
import * as C from './creatures';
import * as F from './folders';
import { VERSION, ENGINE, BUILT_AT, STARTED_AT } from './version';
import { getLogs, logEvent } from './logbuffer';
import { listLibraries, listCollections, updateCollection, createCollection, deleteCollection, deleteLibrary, getNode, getDescendants, creatureLibraryIds, invalidateLibraryIndex } from './libraries';
import { spawn } from 'node:child_process';

export type AppOptions = { db: DB, setupToken?: string };

export function createApp({ db, setupToken }: AppOptions) {
  const app = new Hono<Env>();

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Library imports can be large; everything else is capped at 20 MB
  const smallBody = bodyLimit({ maxSize: 20 * 1024 * 1024, onError: c => c.json({ error: 'Upload too large (20 MB max)' }, 413) });
  const largeBody = bodyLimit({ maxSize: 250 * 1024 * 1024, onError: c => c.json({ error: 'Upload too large (250 MB max)' }, 413) });
  app.use('/api/*', (c, next) => (c.req.path === '/api/admin/libraries/import' ? largeBody(c, next) : smallBody(c, next)));
  // CORS, only for addresses an admin listed (Admin → Registration and limits → Other addresses)
  // or ALLOWED_ORIGINS. Everything else stays same-origin only.
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = !!origin && !sameOrigin(origin, c) && trustedOrigin(db, origin);
    const cors = (h: Headers) => {
      h.set('Access-Control-Allow-Origin', origin!);
      h.set('Access-Control-Allow-Credentials', 'true');
      h.append('Vary', 'Origin');
      h.set('Cross-Origin-Resource-Policy', 'cross-origin');
    };
    if (c.req.method === 'OPTIONS' && origin && c.req.header('access-control-request-method')) {
      if (!allowed) return c.json({ error: 'Cross-origin request blocked' }, 403);
      const res = new Response(null, { status: 204 });
      cors(res.headers);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.headers.set('Access-Control-Allow-Headers', 'content-type, x-requested-with');
      res.headers.set('Access-Control-Max-Age', '600');
      return res;
    }
    await next();
    if (allowed) cors(c.res.headers);
    else c.res.headers.append('Vary', 'Origin');
  });
  app.use('/api/*', authMiddleware(db));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server' }, 500);
  });

  const body = async (c: Context) => {
    try { return await c.req.json(); } catch { throw new HttpError(400, 'Expected JSON'); }
  };

  // ---------------------------------------------------------------- session
  app.get('/api/session', c => {
    const user = c.get('user');
    const s = getSettings(db);
    return c.json({
      user: user && publicUser(db, user),
      registrationOpen: s.registrationOpen,
      siteName: s.siteName,
      needsSetup: userCount(db) === 0,
    });
  });

  app.post('/api/setup', async c => {
    // First-run: create the first admin. Needs the setup token from the server log,
    // so nobody else can claim the instance if it's already public.
    const b = await body(c);
    if (userCount(db) > 0) throw new HttpError(400, 'Setup is already complete');
    if (!setupToken || b.setupToken !== setupToken) throw new HttpError(403, 'Wrong setup token (see the server log)');
    const user = await createUser(db, { username: b.username, password: b.password, isAdmin: true });
    createSession(db, c, user.id);
    return c.json({ user: publicUser(db, user) });
  });

  app.post('/api/login', async c => {
    const b = await body(c);
    const who = typeof b.username === 'string' ? b.username.trim().slice(0, 40) : '?';
    let user;
    try { user = await login(db, c, b.username, b.password); } catch (e: any) {
      logEvent('auth', `failed sign-in for "${who}" from ${clientIp(c)}: ${e?.message || e}`, 'warn');
      throw e;
    }
    logEvent('auth', `signed in: ${user.username} from ${clientIp(c)}${c.req.header('origin') ? ` via ${c.req.header('origin')}` : ''}`);
    return c.json({ user: publicUser(db, user) });
  });

  app.post('/api/logout', c => {
    destroySession(db, c);
    return c.json({ ok: true });
  });

  app.post('/api/register', async c => {
    const b = await body(c);
    if (!getSettings(db).registrationOpen) throw new HttpError(403, 'Registration is closed');
    const user = await createUser(db, { username: b.username, password: b.password });
    createSession(db, c, user.id);
    return c.json({ user: publicUser(db, user) });
  });

  app.post('/api/account/password', async c => {
    const user = requireUser(c);
    const b = await body(c);
    const row = q(db, 'SELECT password_hash FROM users WHERE id = ?').get(user.id) as any;
    if (typeof b.currentPassword !== 'string' || !(await verifyPassword(b.currentPassword, row.password_hash))) {
      throw new HttpError(400, 'Current password is wrong');
    }
    await changePassword(db, user.id, b.newPassword);
    createSession(db, c, user.id);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- admin
  app.get('/api/admin/users', c => {
    requireAdmin(c);
    const rows = q(db, `SELECT u.id, u.username, u.is_admin, u.character_limit, u.disabled, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM creatures WHERE owner_id = u.id) AS characters FROM users u ORDER BY u.username`).all();
    return c.json({ users: rows, settings: getSettings(db) });
  });

  app.post('/api/admin/users', async c => {
    const admin = requireAdmin(c);
    const b = await body(c);
    const user = await createUser(db, { username: b.username, password: b.password, isAdmin: !!b.isAdmin, characterLimit: b.characterLimit ?? undefined });
    logEvent('admin', `${admin.username} added user ${user.username}${b.isAdmin ? ' (admin)' : ''}`);
    return c.json({ user });
  });

  app.patch('/api/admin/users/:id', async c => {
    const admin = requireAdmin(c);
    const id = c.req.param('id');
    const target = getUser(db, id);
    if (!target) throw new HttpError(404, 'User not found');
    const b = await body(c);
    if ('characterLimit' in b) {
      const limit = b.characterLimit === null ? null : validateCharacterLimit(b.characterLimit);
      q(db, 'UPDATE users SET character_limit = ? WHERE id = ?').run(limit, id);
    }
    if ('isAdmin' in b) {
      if (id === admin.id && !b.isAdmin) throw new HttpError(400, "You can't remove your own admin rights");
      q(db, 'UPDATE users SET is_admin = ? WHERE id = ?').run(b.isAdmin ? 1 : 0, id);
    }
    if ('disabled' in b) {
      if (id === admin.id) throw new HttpError(400, "You can't disable your own account");
      q(db, 'UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, id);
      if (b.disabled) destroyUserSessions(db, id);
    }
    if ('password' in b) await changePassword(db, id, b.password);
    const changes = [
      'characterLimit' in b && `character limit ${b.characterLimit ?? 'default'}`,
      'isAdmin' in b && (b.isAdmin ? 'made admin' : 'admin removed'),
      'disabled' in b && (b.disabled ? 'disabled' : 'enabled'),
      'password' in b && 'password reset',
    ].filter(Boolean).join(', ');
    if (changes) logEvent('admin', `${admin.username} changed ${target.username}: ${changes}`);
    return c.json({ user: getUser(db, id) });
  });

  app.delete('/api/admin/users/:id', c => {
    const admin = requireAdmin(c);
    const id = c.req.param('id');
    if (id === admin.id) throw new HttpError(400, "You can't delete your own account");
    const gone = getUser(db, id);
    q(db, 'DELETE FROM users WHERE id = ?').run(id);
    if (gone) logEvent('admin', `${admin.username} deleted user ${gone.username}`, 'warn');
    return c.json({ ok: true });
  });

  app.get('/api/admin/settings', c => { requireAdmin(c); return c.json(getSettings(db)); });
  app.get('/api/admin/logs', c => {
    requireAdmin(c);
    const after = Math.max(0, Number(c.req.query('after')) || 0);
    return c.json(getLogs(after, 1000));
  });
  app.get('/api/admin/about', c => {
    requireAdmin(c);
    const count = (t: string) => (q(db, `SELECT COUNT(*) n FROM ${t}`).get() as any).n;
    return c.json({
      version: VERSION, engine: ENGINE, builtAt: BUILT_AT, startedAt: STARTED_AT, node: process.version,
      database: (db.prepare('PRAGMA user_version').get() as any).user_version,
      counts: { users: count('users'), characters: count('creatures'), libraries: count('libraries') },
    });
  });
  app.patch('/api/admin/settings', async c => {
    const admin = requireAdmin(c);
    const b = await body(c);
    const saved = updateSettings(db, b);
    const what = Object.keys(b).map(k => k === 'registrationOpen' ? `sign-ups ${b[k] ? 'opened' : 'closed'}`
      : k === 'allowedOrigins' ? `other addresses: ${saved.allowedOrigins.join(', ') || 'none'}`
      : k === 'defaultCharacterLimit' ? `default character limit ${saved.defaultCharacterLimit}`
      : k === 'siteName' ? `site name "${saved.siteName}"` : k).join('; ');
    if (what) logEvent('admin', `${admin.username} changed settings: ${what}`);
    return c.json(saved);
  });

  app.post('/api/admin/libraries/import', async c => {
    requireAdmin(c);
    // Accept the mongoexport .tgz, or a JSON / JSONL file, as a multipart upload
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose a file to upload');
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesheet-'));
    const safeName = /\.(tgz|tar\.gz|jsonl|json)$/.exec(file.name)?.[0];
    if (!safeName) throw new HttpError(400, 'Upload a .tgz, .json or .jsonl file');
    const p = path.join(dir, (/^(libraries|libraryNodes|libraryCollections)\./.exec(file.name)?.[1] || 'upload') + safeName);
    try {
      fs.writeFileSync(p, Buffer.from(await file.arrayBuffer()));
      // Parse in a short-lived child process: a library export is ~80 MB of JSON,
      // and the memory used to parse it is returned to the OS when the child exits.
      const stats = await runImportProcess(p);
      invalidateLibraryIndex();
      logEvent('admin', `library file imported (${file.name}): ${JSON.stringify(stats)}`);
      return c.json(stats);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  app.post('/api/admin/collections', async c => {
    requireAdmin(c);
    return c.json(createCollection(db, await body(c)));
  });
  app.patch('/api/admin/collections/:id', async c => {
    requireAdmin(c);
    const b = await body(c);
    return c.json(updateCollection(db, c.req.param('id'), { name: b.name, libraries: b.libraries }));
  });
  app.delete('/api/admin/collections/:id', c => {
    requireAdmin(c);
    deleteCollection(db, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.delete('/api/admin/libraries/:id', c => {
    const admin = requireAdmin(c);
    deleteLibrary(db, c.req.param('id'));
    logEvent('admin', `${admin.username} removed library ${c.req.param('id')}`, 'warn');
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- libraries
  app.get('/api/libraries', c => {
    requireUser(c);
    return c.json({ libraries: listLibraries(db), collections: listCollections(db) });
  });

  app.get('/api/library-nodes/:id', c => {
    requireUser(c);
    const node = getNode(db, c.req.param('id'));
    if (!node) throw new HttpError(404, 'Not found');
    const descendants = c.req.query('children') ? getDescendants(db, node) : undefined;
    return c.json({ node, descendants });
  });

  // ---------------------------------------------------------------- characters
  app.get('/api/characters', c => {
    const user = requireUser(c);
    return c.json({ characters: C.listCreatures(db, user), folders: F.listFolders(db, user), usage: C.characterUsage(db, user) });
  });

  // Folders for the character list
  app.post('/api/folders', async c => c.json(F.createFolder(db, requireUser(c), await body(c))));
  app.patch('/api/folders/:id', async c => { F.updateFolder(db, requireUser(c), c.req.param('id'), await body(c)); return c.json({ ok: true }); });
  app.delete('/api/folders/:id', c => { F.deleteFolder(db, requireUser(c), c.req.param('id')); return c.json({ ok: true }); });
  app.put('/api/characters/:id/folder', async c => { F.moveCharacter(db, requireUser(c), c.req.param('id'), (await body(c)).folderId); return c.json({ ok: true }); });

  app.post('/api/characters', async c => {
    const user = requireUser(c);
    const b = await body(c);
    const id = await C.createCreature(db, user, b);
    return c.json({ id });
  });

  app.post('/api/characters/import', async c => {
    const user = requireUser(c);
    const archive = await body(c);
    return c.json(await C.importArchive(db, user, archive));
  });

  const creatureRoute = (write: boolean) => (c: Context<Env>) => C.loadCreatureFor(db, requireUser(c), c.req.param('id')!, write);
  const read = creatureRoute(false), write = creatureRoute(true);
  const locked = <T>(c: Context<Env>, fn: () => Promise<T>) => C.withCreatureLock(c.req.param('id')!, fn);

  app.get('/api/characters/:id', c => {
    const creature = read(c);
    return c.json({ ...C.getCreatureView(db, creature._id), canEdit: canEdit(c, creature) });
  });

  app.patch('/api/characters/:id', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      await C.updateCreature(db, creature, b);
      return c.json(C.getCreatureView(db, creature._id));
    });
  });

  app.delete('/api/characters/:id', c => {
    const creature = write(c);
    if (creature.owner !== requireUser(c).id && !requireUser(c).is_admin) throw new HttpError(403, 'Only the owner can delete');
    C.deleteCreature(db, creature._id);
    return c.json({ ok: true });
  });

  app.post('/api/characters/:id/recompute', c => locked(c, async () => {
    const creature = write(c);
    await C.recompute(db, creature._id);
    return c.json(C.getCreatureView(db, creature._id));
  }));

  app.get('/api/characters/:id/export', c => {
    const creature = read(c);
    const version = c.req.query('version') === '2' ? 2 : 3;
    const archive = C.exportArchive(db, creature._id, version);
    const name = (creature.name || 'character').replace(/[^\w .-]+/g, '_').slice(0, 60);
    c.header('Content-Disposition', `attachment; filename="${name}${version === 2 ? ' (DiceCloud v2)' : ''}.json"`);
    return c.json(archive);
  });

  app.get('/api/characters/:id/libraries', c => {
    const creature = read(c);
    return c.json({
      allowedLibraries: creature.allowedLibraries ?? null,
      allowedLibraryCollections: creature.allowedLibraryCollections ?? null,
      effectiveLibraryIds: creatureLibraryIds(db, creature),
    });
  });

  app.get('/api/characters/:id/logs', c => {
    const creature = read(c);
    return c.json({ logs: C.getLogs(db, creature._id) });
  });

  app.post('/api/characters/:id/logs', async c => {
    const b = await body(c);
    const creature = write(c);
    if (!Array.isArray(b.content) || b.content.length > 20) throw new HttpError(400, 'Invalid log');
    return c.json(C.addLog(db, creature, b.content.map((x: any) => ({ name: String(x.name ?? '').slice(0, 200), value: String(x.value ?? '').slice(0, 2000), inline: !!x.inline }))));
  });

  app.post('/api/characters/:id/experiences', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      C.addExperience(db, creature, b);
      await C.recompute(db, creature._id);
      return c.json(C.getCreatureView(db, creature._id));
    });
  });

  app.delete('/api/characters/:id/experiences/:expId', c => locked(c, async () => {
    const creature = write(c);
    C.removeExperience(db, creature, c.req.param('expId'));
    await C.recompute(db, creature._id);
    return c.json(C.getCreatureView(db, creature._id));
  }));

  app.post('/api/characters/:id/rest', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      // Rests go through DiceCloud's action engine so rest triggers fire too
      const r = await C.runAction(db, creature, { task: { kind: 'reset', eventName: b.type } });
      return c.json({ ...r, ...C.getCreatureView(db, creature._id) });
    });
  });

  // Run an action, spell, buff or other property with DiceCloud's action engine.
  // May answer { status: 'needsInput', request, seed, decisions }: ask the player, then call again.
  app.post('/api/characters/:id/actions', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      const r = await C.runAction(db, creature, { task: b.task, seed: b.seed, decisions: b.decisions });
      if (r.status === 'needsInput') return c.json(r);
      return c.json({ ...r, ...C.getCreatureView(db, creature._id) });
    });
  });

  // Slots
  app.get('/api/characters/:id/slots/:slotId/fillers', async c => {
    const creature = read(c);
    return c.json(await C.slotFillers(db, creature, c.req.param('slotId'), {
      search: c.req.query('search'), limit: Number(c.req.query('limit')) || undefined, offset: Number(c.req.query('offset')) || undefined,
    }));
  });

  app.post('/api/characters/:id/slots/:slotId/fill', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      const ids = await C.fillSlot(db, creature, c.req.param('slotId'), b.nodeIds, !!b.ignoreRequirements);
      return c.json({ insertedIds: ids, ...C.getCreatureView(db, creature._id) });
    });
  });

  // Properties
  app.post('/api/characters/:id/properties', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      let ids: string[];
      if (Array.isArray(b.libraryNodeIds)) {
        ids = C.insertNodes(db, creature, b.libraryNodeIds, b.parentId);
        await C.recompute(db, creature._id);
      } else {
        ids = [await C.insertProperty(db, creature, { property: b.property, parentId: b.parentId, slotId: b.slotId })];
      }
      return c.json({ insertedIds: ids, ...C.getCreatureView(db, creature._id) });
    });
  });

  app.patch('/api/characters/:id/properties/:propId', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      await C.updateProperty(db, creature, c.req.param('propId'), b.path, b.value);
      return c.json(C.getCreatureView(db, creature._id));
    });
  });

  app.post('/api/characters/:id/properties/:propId/adjust', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      await C.adjustProperty(db, creature, c.req.param('propId'), b);
      return c.json(C.getCreatureView(db, creature._id));
    });
  });

  app.post('/api/characters/:id/properties/:propId/move', async c => {
    const b = await body(c);
    return locked(c, async () => {
      const creature = write(c);
      await C.moveProperty(db, creature, c.req.param('propId'), b.parentId ?? null, b.beforeId);
      return c.json(C.getCreatureView(db, creature._id));
    });
  });

  app.delete('/api/characters/:id/properties/:propId', c => locked(c, async () => {
    const creature = write(c);
    await C.removeProperty(db, creature, c.req.param('propId'));
    return c.json(C.getCreatureView(db, creature._id));
  }));

  app.post('/api/characters/:id/properties/:propId/restore', c => locked(c, async () => {
    const creature = write(c);
    await C.restoreProperty(db, creature, c.req.param('propId'));
    return c.json(C.getCreatureView(db, creature._id));
  }));

  app.all('/api/*', c => c.json({ error: 'Not found' }, 404));
  return app;
}

function runImportProcess(file: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], 'import-libraries', file, '--json'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      const line = out.trim().split('\n').pop() || '';
      if (code === 0) { try { return resolve(JSON.parse(line)); } catch { /* fall through */ } }
      reject(new HttpError(400, (err.trim().split('\n').filter(l => !/warning/i.test(l)).pop()) || 'Import failed'));
    });
  });
}

function canEdit(c: Context<Env>, creature: any) {
  const u = c.get('user')!;
  return creature.owner === u.id || !!u.is_admin || creature.writers?.includes(u.id);
}

function publicUser(db: DB, u: any) {
  return {
    id: u.id, username: u.username, isAdmin: !!u.is_admin,
    characterLimit: effectiveCharacterLimit(db, u),
  };
}

void now; void tx;
