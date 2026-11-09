import { cloneDeep, isEqual, get, set, unset } from 'lodash';
import { type DB, q, tx, now } from './db';
import { HttpError } from './settings';
import { type User, effectiveCharacterLimit } from './auth';
import {
  type Doc, computeCreature, serializeScope, migrateArchive, defaultCharacterProperties, rebuildNestedSets,
  evaluateCondition, getSlotFillFilter, cleanProperty, cleanCreature, getDefaultSlotFiller, newId, SCHEMA_VERSION,
} from '../engine/index';
import { getNode, getDescendants, copyNodesForCreature, creatureLibraryIds, findSlotFillers, listCollections, listLibraries } from './libraries';
import { runEngineAction, type EngineTask } from '../engine/actions';

// ---------------------------------------------------------------------------
// Loading & access
// ---------------------------------------------------------------------------
export function getCreatureRow(db: DB, id: string) {
  return q(db, 'SELECT id, owner_id, doc, variables, updated_at FROM creatures WHERE id = ?').get(id) as
    { id: string, owner_id: string, doc: string, variables: string | null, updated_at: string } | undefined;
}

/** Owner or admin may read/write. (Sharing can be added later via readers/writers.) */
export function loadCreatureFor(db: DB, user: User, id: string, write = false): Doc {
  const row = getCreatureRow(db, id);
  if (!row) throw new HttpError(404, 'Character not found');
  const doc = JSON.parse(row.doc);
  const canRead = row.owner_id === user.id || !!user.is_admin || doc.public
    || doc.readers?.includes(user.id) || doc.writers?.includes(user.id);
  const canWrite = row.owner_id === user.id || !!user.is_admin || doc.writers?.includes(user.id);
  if (!(write ? canWrite : canRead)) throw new HttpError(404, 'Character not found');
  return doc;
}

export function loadProps(db: DB, creatureId: string, includeRemoved = false): Doc[] {
  const sql = includeRemoved
    ? 'SELECT doc FROM creature_properties WHERE creature_id = ?'
    : 'SELECT doc FROM creature_properties WHERE creature_id = ? AND removed = 0';
  return (q(db, sql).all(creatureId) as any[]).map(r => JSON.parse(r.doc));
}

function saveProp(db: DB, creatureId: string, prop: Doc) {
  q(db, 'INSERT INTO creature_properties (id, creature_id, removed, doc) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET removed = excluded.removed, doc = excluded.doc')
    .run(prop._id, creatureId, prop.removed ? 1 : 0, JSON.stringify(prop));
}

function saveCreatureDoc(db: DB, creature: Doc) {
  q(db, 'UPDATE creatures SET doc = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(creature), now(), creature._id);
}

export function listCreatures(db: DB, user: User) {
  return (q(db, 'SELECT id, doc, variables, updated_at, folder_id, species FROM creatures WHERE owner_id = ? ORDER BY updated_at DESC').all(user.id) as any[])
    .map(r => {
      const c = JSON.parse(r.doc);
      const v = r.variables ? JSON.parse(r.variables) : {};
      return {
        _id: c._id, name: c.name, alignment: c.alignment, gender: c.gender, picture: c.avatarPicture || c.picture,
        color: c.color, level: v.level?.value, race: (r.species ?? speciesFromProps(db, r.id)) || raceName(v), updatedAt: r.updated_at,
        folderId: r.folder_id || null,
      };
    });
}

const titleCase = (x: string) => x.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, ch => ch.toUpperCase()).trim();
/** Race for the character list. Libraries usually define `race` as a constant whose value is the race ("tiefling"). */
function raceName(v: Record<string, any>): string | undefined {
  for (const k of ['species', 'race', 'lineage']) {
    const x = v[k];
    if (!x) continue;
    if (typeof x.value === 'string' && x.value) return titleCase(x.value);
    if (x.type !== 'constant' && x.name) return x.name;
  }
  return undefined;
}

/** For characters not recomputed since 0.1.12: find the chosen species once and remember it. */
function speciesFromProps(db: DB, creatureId: string): string | undefined {
  const name = chosenSpecies(loadProps(db, creatureId));
  q(db, 'UPDATE creatures SET species = ? WHERE id = ?').run(name ?? '', creatureId);
  return name;
}

function characterCount(db: DB, userId: string): number {
  return (q(db, 'SELECT COUNT(*) n FROM creatures WHERE owner_id = ?').get(userId) as any).n;
}

export function assertCharacterSlot(db: DB, user: User) {
  const limit = effectiveCharacterLimit(db, user);
  if (characterCount(db, user.id) >= limit) {
    throw new HttpError(403, `You have reached your character limit (${limit}). Ask an admin to raise it, or delete a character.`);
  }
}

export function characterUsage(db: DB, user: User) {
  return { used: characterCount(db, user.id), limit: effectiveCharacterLimit(db, user) };
}

// ---------------------------------------------------------------------------
// Compute: run the DiceCloud engine and persist what changed, like the
// upstream server's writeAlteredProperties + writeScope + writeErrors.
// ---------------------------------------------------------------------------
const locks = new Map<string, Promise<unknown>>();
/** Serialize work per creature so concurrent edits can't interleave with a compute. */
export function withCreatureLock<T>(creatureId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(creatureId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(creatureId, run);
  run.finally(() => { if (locks.get(creatureId) === run) locks.delete(creatureId); }).catch(() => {});
  return run;
}

/** Last computation per creature (scope with live values), used for requirement checks. */
const scopeCache = new Map<string, { scope: Record<string, any>, at: number }>();
const SCOPE_CACHE_SIZE = 50;

/**
 * Actions that use up an item (thrown daggers, arrows…) name the item by tag; the player picks
 * which item (DiceCloud's "select item to consume" dialog stores it as itemsConsumed[].itemId).
 * When exactly one item on the character matches, pick it, so the action isn't shown as
 * lacking resources. Returns the props, with changed ones cloned.
 */
function pickConsumedItems(props: Doc[]): Doc[] {
  const items = props.filter(p => p.type === 'item' && !p.removed && !p.inactive);
  return props.map(p => {
    const list = p.resources?.itemsConsumed;
    if (!Array.isArray(list) || p.removed || !list.some((c: any) => c && !c.itemId && c.tag)) return p;
    let changed = false;
    const next = cloneDeep(p);
    for (const c of next.resources.itemsConsumed) {
      if (!c || c.itemId || !c.tag) continue;
      const matches = items.filter(i => (i.tags || []).includes(c.tag));
      if (matches.length === 1) { c.itemId = matches[0]._id; changed = true; }
    }
    return changed ? next : p;
  });
}

/** The race/species the player chose: what fills the race/species/lineage slot. */
export function chosenSpecies(props: Doc[]): string | undefined {
  const byParent = new Map<string, Doc[]>();
  for (const p of props) if (p.parentId && !p.removed) { if (!byParent.has(p.parentId)) byParent.set(p.parentId, []); byParent.get(p.parentId)!.push(p); }
  const names = props
    .filter(s => s.type === 'propertySlot' && !s.removed && !s.inactive && (s.slotTags || []).some((t: string) => /^(race|species|lineage)$/i.test(t)))
    .flatMap(s => (byParent.get(s._id) || []).filter(c => !c.inactive && c.type !== 'effect'))
    .map(c => String(c.name || '').replace(/^!+\s*/, '').trim()).filter(Boolean);
  return names.length ? [...new Set(names)].join(', ') : undefined;
}

export async function recompute(db: DB, creatureId: string) {
  const row = getCreatureRow(db, creatureId);
  if (!row) throw new HttpError(404, 'Character not found');
  const creature = JSON.parse(row.doc);
  const original = loadProps(db, creatureId);
  const byId = new Map(original.map(p => [p._id, p]));
  const result = await computeCreature(creature, pickConsumedItems(original));

  tx(db, () => {
    for (const prop of result.props) {
      const clean = stripComputation(prop);
      if (!isEqual(clean, byId.get(prop._id))) saveProp(db, creatureId, clean);
    }
    creature.propCount = result.props.length;
    creature.lastComputedAt = now();
    if (result.errors.length) creature.computeErrors = result.errors; else delete creature.computeErrors;
    delete creature.dirty;
    q(db, 'UPDATE creatures SET doc = ?, variables = ?, species = ? WHERE id = ?')
      .run(JSON.stringify(creature), JSON.stringify(serializeScope(result.scope)), chosenSpecies(result.props) ?? null, creatureId);
  });
  scopeCache.delete(creatureId);
  scopeCache.set(creatureId, { scope: result.scope, at: Date.now() });
  while (scopeCache.size > SCOPE_CACHE_SIZE) scopeCache.delete(scopeCache.keys().next().value!);
  return result;
}

function stripComputation(prop: any): Doc {
  const p = { ...prop };
  delete p._computationDetails;
  delete p.dirty;
  // Drop undefined values so stored JSON stays stable
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return JSON.parse(JSON.stringify(p));
}

async function getScope(db: DB, creatureId: string) {
  const cached = scopeCache.get(creatureId);
  if (cached) return cached.scope;
  return (await recompute(db, creatureId)).scope;
}

export function getCreatureView(db: DB, creatureId: string) {
  const row = getCreatureRow(db, creatureId)!;
  return {
    creature: JSON.parse(row.doc),
    properties: loadProps(db, creatureId),
    variables: row.variables ? JSON.parse(row.variables) : {},
    experiences: (q(db, 'SELECT doc FROM experiences WHERE creature_id = ?').all(creatureId) as any[]).map(r => JSON.parse(r.doc)),
    updatedAt: row.updated_at,
  };
}

export function getLogs(db: DB, creatureId: string, limit = 100) {
  return (q(db, 'SELECT doc FROM creature_logs WHERE creature_id = ? ORDER BY created_at DESC LIMIT ?').all(creatureId, limit) as any[])
    .map(r => JSON.parse(r.doc));
}

// ---------------------------------------------------------------------------
// Create / delete / duplicate
// ---------------------------------------------------------------------------
const CREATURE_TEXT_FIELDS = ['name', 'alignment', 'gender', 'picture', 'avatarPicture', 'color'] as const;

export async function createCreature(db: DB, user: User, input: any) {
  assertCharacterSlot(db, user);
  const id = newId();
  const creature: Doc = cleanCreature({
    _id: id,
    owner: user.id,
    name: str(input.name, 'Name', 100) || 'New Character',
    gender: str(input.gender, 'Gender', 100),
    alignment: str(input.alignment, 'Alignment', 100),
    type: 'pc',
    settings: {},
    readers: [],
    writers: [],
    public: false,
    ...libraryChoice(db, input),
  } as Doc);
  const startingLevel = input.startingLevel === undefined ? 0 : Number(input.startingLevel);
  if (!Number.isInteger(startingLevel) || startingLevel < 0 || startingLevel > 20) throw new HttpError(400, 'Starting level must be 0-20');

  const props = defaultCharacterProperties(id);
  tx(db, () => {
    q(db, 'INSERT INTO creatures (id, owner_id, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, user.id, JSON.stringify(creature), now(), now());
    for (const p of props) saveProp(db, id, p);
    if (startingLevel) addExperience(db, creature, { name: 'Starting level', levels: startingLevel });
  });

  // Like DiceCloud: if exactly one ruleset fits the Ruleset slot, insert it.
  const ruleset = props.find(p => p.name === 'Ruleset');
  if (ruleset) {
    const { total, nodes } = findSlotFillers(db, { filter: getSlotFillFilter(ruleset, creatureLibraryIds(db, creature)), limit: 2 });
    if (total === 1) {
      insertNodes(db, creature, [nodes[0]._id], ruleset._id);
    }
  }
  await recompute(db, id);
  return id;
}

function libraryChoice(db: DB, input: any) {
  const out: any = {};
  const libIds = new Set(listLibraries(db).map(l => l._id));
  const colIds = new Set(listCollections(db).map(c => c._id));
  if (input.allowedLibraries !== undefined && input.allowedLibraries !== null) {
    if (!Array.isArray(input.allowedLibraries) || !input.allowedLibraries.every((i: any) => libIds.has(i))) throw new HttpError(400, 'Unknown library');
    out.allowedLibraries = input.allowedLibraries;
  }
  if (input.allowedLibraryCollections !== undefined && input.allowedLibraryCollections !== null) {
    if (!Array.isArray(input.allowedLibraryCollections) || !input.allowedLibraryCollections.every((i: any) => colIds.has(i))) throw new HttpError(400, 'Unknown library collection');
    out.allowedLibraryCollections = input.allowedLibraryCollections;
  }
  return out;
}

function str(v: unknown, label: string, max: number): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${label} must be text up to ${max} characters`);
  return v;
}

export async function updateCreature(db: DB, creature: Doc, input: any) {
  for (const k of CREATURE_TEXT_FIELDS) {
    if (k in input) {
      const v = str(input[k], k, k.includes('icture') ? 2000 : 100);
      if (v === undefined) delete creature[k]; else creature[k] = v;
    }
  }
  if ('allowedLibraries' in input || 'allowedLibraryCollections' in input) {
    const choice = libraryChoice(db, input);
    if ('allowedLibraries' in input) { if (input.allowedLibraries === null) delete creature.allowedLibraries; else creature.allowedLibraries = choice.allowedLibraries; }
    if ('allowedLibraryCollections' in input) { if (input.allowedLibraryCollections === null) delete creature.allowedLibraryCollections; else creature.allowedLibraryCollections = choice.allowedLibraryCollections; }
  }
  if ('settings' in input) {
    if (!input.settings || typeof input.settings !== 'object') throw new HttpError(400, 'settings must be an object');
    creature.settings = { ...creature.settings, ...input.settings };
  }
  saveCreatureDoc(db, cleanCreature(creature));
  await recompute(db, creature._id);
}

export function deleteCreature(db: DB, creatureId: string) {
  tx(db, () => {
    q(db, 'DELETE FROM creatures WHERE id = ?').run(creatureId);
  });
  scopeCache.delete(creatureId);
}

// ---------------------------------------------------------------------------
// Experience (DiceCloud keeps a running total in creature.denormalizedStats)
// ---------------------------------------------------------------------------
export function addExperience(db: DB, creature: Doc, input: any) {
  const exp: Doc = { _id: newId(), creatureId: creature._id, name: str(input.name, 'Name', 100) || 'Experience', date: now() };
  if (input.xp !== undefined) { if (!Number.isFinite(+input.xp)) throw new HttpError(400, 'XP must be a number'); exp.xp = +input.xp; }
  if (input.levels !== undefined) { if (!Number.isInteger(+input.levels)) throw new HttpError(400, 'Levels must be whole'); exp.levels = +input.levels; }
  creature.denormalizedStats = creature.denormalizedStats || {};
  creature.denormalizedStats.xp = (creature.denormalizedStats.xp || 0) + (exp.xp || 0);
  creature.denormalizedStats.milestoneLevels = (creature.denormalizedStats.milestoneLevels || 0) + (exp.levels || 0);
  tx(db, () => {
    q(db, 'INSERT INTO experiences (id, creature_id, doc) VALUES (?, ?, ?)').run(exp._id, creature._id, JSON.stringify(exp));
    saveCreatureDoc(db, creature);
  });
  return exp;
}

export function removeExperience(db: DB, creature: Doc, expId: string) {
  const row = q(db, 'SELECT doc FROM experiences WHERE id = ? AND creature_id = ?').get(expId, creature._id) as any;
  if (!row) throw new HttpError(404, 'Experience not found');
  const exp = JSON.parse(row.doc);
  creature.denormalizedStats = creature.denormalizedStats || {};
  creature.denormalizedStats.xp = (creature.denormalizedStats.xp || 0) - (exp.xp || 0);
  creature.denormalizedStats.milestoneLevels = (creature.denormalizedStats.milestoneLevels || 0) - (exp.levels || 0);
  tx(db, () => {
    q(db, 'DELETE FROM experiences WHERE id = ?').run(expId);
    saveCreatureDoc(db, creature);
  });
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------
const MAX_ARCHIVE_PROPS = 5000;

/** Restore a DiceCloud "Creature Archive" JSON (schema v1-v3). Gives everything new ids if it already exists. */
export async function importArchive(db: DB, user: User, archive: any) {
  assertCharacterSlot(db, user);
  if (!archive || typeof archive !== 'object' || !archive.meta || !archive.creature || !Array.isArray(archive.properties)) {
    throw new HttpError(400, 'This is not a DiceCloud character file');
  }
  if (typeof archive.meta.schemaVersion === 'number' && archive.meta.schemaVersion > SCHEMA_VERSION) {
    throw new HttpError(400, `This file is from a newer DiceCloud (schema ${archive.meta.schemaVersion}); this server reads up to ${SCHEMA_VERSION}`);
  }
  if (archive.properties.length > MAX_ARCHIVE_PROPS) throw new HttpError(400, 'Character has too many properties');
  archive = cloneDeep(archive);
  const warnings = migrateArchive(archive);

  let creature: Doc = archive.creature;
  let props: Doc[] = archive.properties;
  let logs: Doc[] = archive.logs || [];
  let experiences: Doc[] = archive.experiences || [];

  // Re-id if this character is already on the server, so the import never overwrites anything
  if (getCreatureRow(db, creature._id) || props.some(p => q(db, 'SELECT 1 FROM creature_properties WHERE id = ?').get(p._id))) {
    ({ creature, props, logs, experiences } = reidArchive(creature, props, logs, experiences));
  }
  creature.owner = user.id;
  creature.readers = []; creature.writers = []; creature.public = false;
  delete creature.tabletopId;
  creature = cleanCreature(creature);

  // Properties must belong to this creature
  for (const p of props) {
    if (p.root?.id !== archive.creature._id && p.root?.id !== creature._id) throw new HttpError(400, 'Character file contains properties of another creature');
    p.root = { collection: 'creatures', id: creature._id };
  }
  rebuildNestedSets(props.filter(p => !p.removed));

  tx(db, () => {
    q(db, 'INSERT INTO creatures (id, owner_id, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(creature._id, user.id, JSON.stringify(creature), now(), now());
    for (const p of props) saveProp(db, creature._id, p);
    for (const e of experiences) q(db, 'INSERT INTO experiences (id, creature_id, doc) VALUES (?, ?, ?)').run(e._id, creature._id, JSON.stringify({ ...e, creatureId: creature._id }));
    for (const l of logs) q(db, 'INSERT INTO creature_logs (id, creature_id, created_at, doc) VALUES (?, ?, ?, ?)')
      .run(l._id, creature._id, String(l.date || now()), JSON.stringify({ ...l, creatureId: creature._id }));
  });
  await recompute(db, creature._id);
  return { id: creature._id, warnings };
}

function reidArchive(creature: Doc, props: Doc[], logs: Doc[], experiences: Doc[]) {
  const map = new Map<string, string>();
  const remap = (id?: string) => (id && map.get(id)) || id;
  map.set(creature._id, newId());
  for (const p of props) map.set(p._id, newId());
  const c = { ...creature, _id: map.get(creature._id)! };
  const ps = props.map(p => {
    const n = cloneDeep(p);
    n._id = map.get(p._id)!;
    n.parentId = remap(p.parentId);
    if (n.parentId === undefined) delete n.parentId;
    n.root = { collection: 'creatures', id: c._id };
    // Keep references between properties intact
    if (n.deactivatingToggleId) n.deactivatingToggleId = remap(n.deactivatingToggleId);
    n.resources?.itemsConsumed?.forEach((i: any) => { i.itemId = remap(i.itemId); });
    return n;
  });
  return {
    creature: c, props: ps,
    logs: logs.map(l => ({ ...l, _id: newId() })),
    experiences: experiences.map(e => ({ ...e, _id: newId() })),
  };
}

/**
 * Export as a DiceCloud archive. version 3 = DiceCloud develop / this app;
 * version 2 = dicecloud.com and DiceCloud master (Meteor 2) servers.
 */
export function exportArchive(db: DB, creatureId: string, version: 2 | 3 = 3) {
  const row = getCreatureRow(db, creatureId)!;
  const creature = JSON.parse(row.doc);
  const properties = loadProps(db, creatureId, true);
  const experiences = (q(db, 'SELECT doc FROM experiences WHERE creature_id = ?').all(creatureId) as any[]).map(r => JSON.parse(r.doc));
  const logs = (q(db, 'SELECT doc FROM creature_logs WHERE creature_id = ? ORDER BY created_at').all(creatureId) as any[]).map(r => JSON.parse(r.doc));
  delete creature.variables;
  const archive = {
    meta: { type: 'DiceCloud V2 Creature Archive', schemaVersion: version, archiveDate: now() },
    creature, properties, experiences, logs,
  };
  if (version === 2) toSchemaV2(archive);
  return archive;
}

/** Inverse of DiceCloud's migrateProperty2To3: parentId/left/right -> parent/ancestors/order. */
function toSchemaV2(archive: any) {
  const creatureRef = { collection: 'creatures', id: archive.creature._id };
  const byId = new Map<string, any>(archive.properties.map((p: any) => [p._id, p]));
  const sorted = [...archive.properties].sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  sorted.forEach((p, i) => { p.__order = i; });
  for (const p of archive.properties) {
    const chain: any[] = [];
    let cur = p.parentId && byId.get(p.parentId);
    const seen = new Set();
    while (cur && !seen.has(cur._id)) { seen.add(cur._id); chain.unshift({ collection: 'creatureProperties', id: cur._id }); cur = cur.parentId && byId.get(cur.parentId); }
    p.ancestors = [creatureRef, ...chain];
    p.parent = chain.length ? chain[chain.length - 1] : creatureRef;
  }
  for (const p of archive.properties) {
    p.order = p.__order;
    delete p.__order; delete p.left; delete p.right; delete p.parentId; delete p.root;
    dropParseCaches(p);
  }
}

/**
 * Remove cached parse results from every calculation and inline-calculation field.
 * DiceCloud reuses a cached parse tree when the formula's hash is unchanged, and the
 * newer parser's trees differ from dicecloud.com's (e.g. accessor nodes without `path`),
 * which crashed dicecloud.com's engine. Without the cache it parses each formula itself.
 */
function dropParseCaches(o: any, depth = 0): void {
  if (!o || typeof o !== 'object' || depth > 12) return;
  if (Array.isArray(o)) { for (const x of o) dropParseCaches(x, depth + 1); return; }
  if (typeof o.calculation === 'string') {
    delete o.hash; delete o.parseNode; delete o.parseError; delete o.valueNode;
  }
  if (typeof o.text === 'string' && ('inlineCalculations' in o || 'hash' in o)) {
    delete o.hash; delete o.inlineCalculations;
  }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') dropParseCaches(v, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// Properties: insert from library, slot fillers, edit, remove
// ---------------------------------------------------------------------------
export function insertNodes(db: DB, creature: Doc, nodeIds: string[], parentId?: string): string[] {
  if (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.length > 20) throw new HttpError(400, 'Choose 1-20 library entries');
  if (parentId) assertPropOf(db, creature._id, parentId);
  const allowed = new Set(creatureLibraryIds(db, creature));
  const copied = copyNodesForCreature(db, nodeIds, creature._id, parentId);
  assertRoomForProps(db, creature._id, copied.length);
  for (const n of copied) {
    if (n.libraryNodeId && n === copied[0] && !allowed.has((q(db, 'SELECT library_id FROM library_nodes WHERE id = ?').get(n.libraryNodeId) as any)?.library_id)) {
      throw new HttpError(403, 'That library is not enabled for this character');
    }
  }
  tx(db, () => {
    const all = [...loadProps(db, creature._id), ...copied];
    rebuildNestedSets(all);
    for (const p of all) saveProp(db, creature._id, p);
  });
  return copied.filter(p => !copied.some(o => o._id === p.parentId)).map(p => p._id);
}

const MAX_PROPS_PER_CREATURE = 3000;
function assertRoomForProps(db: DB, creatureId: string, adding: number) {
  const n = (q(db, 'SELECT COUNT(*) n FROM creature_properties WHERE creature_id = ? AND removed = 0').get(creatureId) as any).n;
  if (n + adding > MAX_PROPS_PER_CREATURE) throw new HttpError(400, `A character can have at most ${MAX_PROPS_PER_CREATURE} properties`);
}

function assertPropOf(db: DB, creatureId: string, propId: string): Doc {
  const r = q(db, 'SELECT doc FROM creature_properties WHERE id = ? AND creature_id = ? AND removed = 0').get(propId, creatureId) as any;
  if (!r) throw new HttpError(404, 'Property not found');
  return JSON.parse(r.doc);
}

/** List what can fill a slot (or level up a class), with requirement results. */
export async function slotFillers(db: DB, creature: Doc, slotId: string, opts: { search?: string, limit?: number, offset?: number, ids?: string[] }) {
  const slot = assertPropOf(db, creature._id, slotId);
  if (slot.type !== 'propertySlot' && slot.type !== 'class') throw new HttpError(400, 'Not a slot or class');
  const libraryIds = creatureLibraryIds(db, creature);
  let filter = getSlotFillFilter(slot, libraryIds);
  if (opts.ids) filter = { $and: [filter, { _id: { $in: opts.ids } }] };
  const { total, nodes } = findSlotFillers(db, {
    filter, search: typeof opts.search === 'string' ? opts.search.slice(0, 100) : undefined,
    limit: Math.min(Number(opts.limit) || 200, 500), offset: Number(opts.offset) || 0,
  });
  const scope = await getScope(db, creature._id);

  // Uniqueness, as in SlotFillDialog.vue
  const added = new Set<string>();
  if (slot.unique) {
    const props = loadProps(db, creature._id);
    const inSlot = (p: Doc) => { let cur: Doc | undefined = p; const byId = new Map(props.map(x => [x._id, x])); while (cur?.parentId) { if (cur.parentId === slot._id) return true; cur = byId.get(cur.parentId); } return false; };
    for (const p of props) {
      if (!p.libraryNodeId) continue;
      if (slot.unique === 'uniqueInCreature' || (slot.unique === 'uniqueInSlot' && inSlot(p))) added.add(p.libraryNodeId);
    }
  }
  const spaceLeft = slot.quantityExpected?.value ? slot.spaceLeft : undefined;
  const libNames = new Map(listLibraries(db).map(l => [l._id, l.name]));

  // Class levels are listed in level order, as in DiceCloud's level-up dialog
  if (slot.type === 'class') nodes.sort((a: any, b: any) => ((a.level ?? a.cache?.node?.level ?? 0) - (b.level ?? b.cache?.node?.level ?? 0)) || String(a.name).localeCompare(String(b.name)));
  const results = [];
  for (const n of nodes) {
    const cond = await evaluateCondition(n.slotFillerCondition, n.slotFillerConditionNote, scope);
    const quantity = typeof n.slotQuantityFilled === 'number' ? n.slotQuantityFilled : 1;
    results.push({
      ...n,
      libraryName: libNames.get(n.root?.id),
      quantity,
      requirementMet: cond.ok,
      requirementNote: cond.note,
      requirementError: cond.error,
      tooBig: spaceLeft !== undefined && quantity > spaceLeft,
      alreadyAdded: added.has(n._id),
    });
  }
  return {
    slot: { _id: slot._id, name: slot.name, type: slot.type, slotType: slot.slotType, spaceLeft, quantityExpected: slot.quantityExpected?.value, totalFilled: slot.totalFilled, unique: slot.unique, missingLevels: slot.missingLevels, level: slot.level, available: !(slot.slotCondition && slot.slotCondition.value === false && !tutorialOnly(slot.slotCondition.calculation)) },
    total, results,
  };
}

// DiceSheet doesn't enforce LoV's tutorial: slot conditions that only track its progress are ignored
const TUTORIAL_VAR = /^(jonStatus|tutorialStatus|tutorial\w*)$/i;
function tutorialOnly(calc?: string) {
  const names = (String(calc || '').match(/[A-Za-z_]\w*/g) || []).filter(w => !/^(true|false|and|or|not)$/i.test(w));
  return names.length > 0 && names.every(w => TUTORIAL_VAR.test(w));
}

/** Fill a slot, enforcing requirements, uniqueness and space like DiceCloud's dialog does. */
export async function fillSlot(db: DB, creature: Doc, slotId: string, nodeIds: string[], allowUnmet = false) {
  if (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.length > 20 || !nodeIds.every(i => typeof i === 'string')) throw new HttpError(400, 'Choose 1-20 entries');
  const { results, slot } = await slotFillers(db, creature, slotId, { limit: 20, ids: nodeIds });
  const byId = new Map(results.map((r: any) => [r._id, r]));
  let quantity = 0;
  for (const id of nodeIds) {
    const r: any = byId.get(id);
    if (!r) throw new HttpError(400, 'That entry cannot fill this slot');
    if (r.alreadyAdded) throw new HttpError(400, `${r.name} is already added`);
    if (!r.requirementMet && !allowUnmet) throw new HttpError(400, `${r.name}: ${r.requirementNote || r.requirementError || 'requirement not met'}`);
    quantity += r.quantity;
  }
  if (slot.available === false) throw new HttpError(400, `${slot.name || 'This slot'} isn't available yet`);
  if (slot.spaceLeft !== undefined && quantity > slot.spaceLeft) throw new HttpError(400, 'Not enough space left in this slot');
  if (slot.type === 'class') {
    const levels = nodeIds.map(id => { const r: any = byId.get(id); return r.level ?? r.cache?.node?.level ?? 0; });
    if (new Set(levels).size !== levels.length) throw new HttpError(400, 'Choose one entry per level');
    nodeIds = [...nodeIds].sort((a, b) => { const ra: any = byId.get(a), rb: any = byId.get(b); return (ra.level ?? ra.cache?.node?.level ?? 0) - (rb.level ?? rb.cache?.node?.level ?? 0); });
  }
  const ids = insertNodes(db, creature, nodeIds, slotId);
  await recompute(db, creature._id);
  return ids;
}

/** Create a custom (non-library) filler for a slot, as DiceCloud's "custom" button does. */
export async function insertProperty(db: DB, creature: Doc, input: { property: any, parentId?: string, slotId?: string }) {
  let prop: Doc;
  if (input.slotId) {
    const slot = assertPropOf(db, creature._id, input.slotId);
    prop = { ...getDefaultSlotFiller(slot), ...(input.property || {}) };
    input.parentId = slot._id;
  } else {
    prop = { ...(input.property || {}) };
  }
  if (!prop.type || typeof prop.type !== 'string') throw new HttpError(400, 'Property type is required');
  const ALLOWED_TYPES = ['action', 'adjustment', 'attribute', 'branch', 'buff', 'buffRemover', 'class', 'classLevel', 'constant', 'container', 'damage', 'damageMultiplier', 'effect', 'feature', 'folder', 'item', 'note', 'pointBuy', 'proficiency', 'propertySlot', 'roll', 'savingThrow', 'skill', 'spell', 'spellList', 'toggle', 'trigger'];
  if (!ALLOWED_TYPES.includes(prop.type)) throw new HttpError(400, 'Unknown property type');
  // "custom": the character's own Custom folder, for changes made by the player or GM
  if (input.parentId === 'custom') input.parentId = ensureCustomFolder(db, creature._id);
  if (input.parentId) assertPropOf(db, creature._id, input.parentId);
  assertRoomForProps(db, creature._id, 1);
  prop._id = newId();
  prop.root = { collection: 'creatures', id: creature._id };
  if (input.parentId) prop.parentId = input.parentId; else delete prop.parentId;
  prop.left = Number.MAX_SAFE_INTEGER / 2; prop.right = prop.left + 1;
  delete prop.removed;
  try { prop = cleanProperty(prop); } catch (e: any) { throw new HttpError(400, e.message); }
  tx(db, () => {
    const all = [...loadProps(db, creature._id), prop];
    rebuildNestedSets(all);
    for (const p of all) saveProp(db, creature._id, p);
  });
  await recompute(db, creature._id);
  return prop._id;
}

export const CUSTOM_TAG = 'dicesheetCustom';
/** The top-level folder that holds a character's custom additions; created on first use. */
function ensureCustomFolder(db: DB, creatureId: string): string {
  const existing = loadProps(db, creatureId).find(p => p.type === 'folder' && p.tags?.includes(CUSTOM_TAG));
  if (existing) return existing._id;
  const folder: Doc = cleanProperty({
    _id: newId(), type: 'folder', name: 'Custom', tags: [CUSTOM_TAG],
    root: { collection: 'creatures', id: creatureId }, left: Number.MAX_SAFE_INTEGER / 2, right: Number.MAX_SAFE_INTEGER / 2 + 1,
  } as Doc);
  tx(db, () => {
    const all = [...loadProps(db, creatureId), folder];
    rebuildNestedSets(all);
    for (const p of all) saveProp(db, creatureId, p);
  });
  return folder._id;
}

const EDIT_BLOCKED = new Set(['_id', 'root', 'parentId', 'left', 'right', 'type', 'removed', 'removedAt', 'libraryNodeId']);

/** Set/unset a field on a property (DiceCloud's updateCreatureProperty), validated by its schema. */
export async function updateProperty(db: DB, creature: Doc, propId: string, path: unknown, value: unknown) {
  if (!Array.isArray(path) || !path.length || !path.every(s => typeof s === 'string' || Number.isInteger(s)) || path.length > 8) throw new HttpError(400, 'Invalid field path');
  if (EDIT_BLOCKED.has(String(path[0])) || path.some(s => String(s).startsWith('$') || s === '__proto__' || s === 'constructor')) throw new HttpError(400, 'That field cannot be edited');
  const prop = assertPropOf(db, creature._id, propId);
  const next = cloneDeep(prop);
  if (value === null || value === undefined) unset(next, path as any); else set(next, path as any, value);
  let clean: Doc;
  try { clean = cleanProperty(next); } catch (e: any) { throw new HttpError(400, e.message); }
  if (!isEqual(get(clean, path as any), value ?? undefined) && value !== null) {
    // The schema cleaned the value into something else (e.g. string -> number); accept the cleaned value
  }
  saveProp(db, creature._id, clean);
  await recompute(db, creature._id);
}

/**
 * Change a resource-like value. For attributes this follows DiceCloud's
 * applyDamagePropTask exactly: `set` sets the current value; `increment`
 * adds DAMAGE (positive = lose, negative = restore), clamped to the limits.
 */
export async function adjustProperty(db: DB, creature: Doc, propId: string, input: { operation: 'increment' | 'set' | 'setMax', value: number }) {
  const prop = assertPropOf(db, creature._id, propId);
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new HttpError(400, 'Value must be a number');
  if (!['set', 'increment', 'setMax'].includes(input.operation)) throw new HttpError(400, 'operation must be set, increment or setMax');
  if (input.operation === 'setMax') {
    // Temporary hit points: the pool is the attribute's base value; set it and refill it.
    if (prop.type !== 'attribute') throw new HttpError(400, 'Only attributes have a maximum');
    if (!Number.isInteger(value) || value < 0 || value > 9999) throw new HttpError(400, 'Use a whole number from 0 to 9999');
    prop.baseValue = { ...(prop.baseValue || {}), calculation: String(value) };
    prop.damage = 0;
  } else if (prop.type === 'attribute') {
    const total = prop.total || 0;
    if (input.operation === 'set') {
      let damage = total - value;
      if (damage > total && !prop.ignoreLowerLimit) damage = total;
      if (damage < 0 && !prop.ignoreUpperLimit) damage = 0;
      prop.damage = damage;
    } else {
      const currentValue = prop.value || 0;
      const currentDamage = prop.damage || 0;
      let increment = value;
      if (increment > currentValue && !prop.ignoreLowerLimit) increment = currentValue;
      if (-increment > currentDamage && !prop.ignoreUpperLimit) increment = -currentDamage;
      prop.damage = currentDamage + increment;
    }
    prop.value = total - prop.damage;
  } else if (prop.type === 'action' || prop.type === 'spell' || prop.type === 'item') {
    const field = prop.type === 'item' ? 'quantity' : 'usesUsed';
    const cur = prop[field] || 0;
    let nextVal = input.operation === 'set' ? value : cur + value;
    if (nextVal < 0) nextVal = 0;
    prop[field] = nextVal;
  } else if (prop.type === 'toggle') {
    prop.enabled = !!value; prop.disabled = !value;
  } else {
    throw new HttpError(400, 'This property cannot be adjusted');
  }
  saveProp(db, creature._id, cleanProperty(prop));
  await recompute(db, creature._id);
}

/** Soft-remove a property and its descendants, like DiceCloud. */
export async function removeProperty(db: DB, creature: Doc, propId: string) {
  const prop = assertPropOf(db, creature._id, propId);
  const props = loadProps(db, creature._id);
  const removedAt = now();
  tx(db, () => {
    for (const p of props) {
      if (p.left >= prop.left && p.right <= prop.right) { p.removed = true; p.removedAt = removedAt; saveProp(db, creature._id, p); }
    }
  });
  await recompute(db, creature._id);
}

export async function restoreProperty(db: DB, creature: Doc, propId: string) {
  const r = q(db, 'SELECT doc FROM creature_properties WHERE id = ? AND creature_id = ?').get(propId, creature._id) as any;
  if (!r) throw new HttpError(404, 'Property not found');
  const prop = JSON.parse(r.doc);
  const all = loadProps(db, creature._id, true);
  tx(db, () => {
    for (const p of all) {
      if (p.removed && p.removedAt === prop.removedAt && p.left >= prop.left && p.right <= prop.right) {
        delete p.removed; delete p.removedAt; saveProp(db, creature._id, p);
      }
    }
  });
  await recompute(db, creature._id);
}

/** Move a property under a new parent (or to top level), keeping its subtree. */
export async function moveProperty(db: DB, creature: Doc, propId: string, newParentId: string | null, beforeId?: string) {
  const prop = assertPropOf(db, creature._id, propId);
  const props = loadProps(db, creature._id);
  const byId = new Map(props.map(p => [p._id, p]));
  if (newParentId) {
    const parent = byId.get(newParentId);
    if (!parent) throw new HttpError(404, 'Destination not found');
    if (parent.left >= prop.left && parent.right <= prop.right) throw new HttpError(400, 'Cannot move a property into itself');
  }
  const moving = props.filter(p => p.left >= prop.left && p.right <= prop.right).sort((a, b) => a.left - b.left);
  let target: number;
  if (beforeId && byId.get(beforeId)) target = byId.get(beforeId)!.left - 0.5;
  else if (newParentId) target = byId.get(newParentId)!.right - 0.5;
  else target = Number.MAX_SAFE_INTEGER / 2;
  const width = prop.right - prop.left + 1;
  moving.forEach(p => {
    const rel = (p.left - prop.left) / width, relR = (p.right - prop.left) / width;
    p.left = target + rel * 0.4; p.right = target + relR * 0.4;
  });
  const me = byId.get(propId)!;
  if (newParentId) me.parentId = newParentId; else delete me.parentId;
  tx(db, () => {
    rebuildNestedSets(props);
    for (const p of props) saveProp(db, creature._id, p);
  });
  await recompute(db, creature._id);
}

/**
 * Run a property (action, spell, buff…), cast a spell, or take a rest through
 * DiceCloud's action engine, then save what it changed and write the log.
 */
export async function runAction(db: DB, creature: Doc, input: { task: EngineTask, seed?: string, decisions?: unknown[] }) {
  const task = input.task as any;
  if (!task || !['prop', 'castSpell', 'reset'].includes(task.kind)) throw new HttpError(400, 'Unknown action');
  if (task.kind !== 'reset' && typeof task.propId !== 'string') throw new HttpError(400, 'Missing property');
  if (task.kind === 'reset' && !['shortRest', 'longRest'].includes(task.eventName)) throw new HttpError(400, 'Rest type must be shortRest or longRest');
  if (input.decisions !== undefined && (!Array.isArray(input.decisions) || input.decisions.length > 100)) throw new HttpError(400, 'Invalid decisions');

  const computed = await recompute(db, creature._id);
  const current = JSON.parse(getCreatureRow(db, creature._id)!.doc);
  let outcome;
  try {
    outcome = await runEngineAction({ creature: current, computedProps: computed.props, scope: computed.scope, task, seed: input.seed, decisions: input.decisions });
  } catch (e: any) {
    throw new HttpError(400, typeof e === 'string' ? e : e?.reason || e?.message || 'The action failed');
  }
  if (outcome.status === 'needsInput') return outcome;

  // Apply the engine's MongoDB-style bulk operations to the stored properties
  const stored = new Map(loadProps(db, creature._id).map(p => [p._id, p]));
  const touched = new Set<string>();
  const inserted: Doc[] = [];
  const deleted = new Set<string>();
  for (const op of outcome.ops) {
    if (op.updateOne) {
      const p = stored.get(op.updateOne.filter?._id);
      if (!p) continue;
      const u = op.updateOne.update || {};
      for (const [k, v] of Object.entries(u.$set || {})) set(p, k, v);
      for (const [k, v] of Object.entries(u.$inc || {})) set(p, k, (Number(get(p, k)) || 0) + Number(v));
      for (const k of Object.keys(u.$unset || {})) unset(p, k);
      touched.add(p._id);
    } else if (op.insertOne) {
      const doc = op.insertOne.document || op.insertOne;
      if (!doc?._id || !doc.type) continue;
      doc.root = { collection: 'creatures', id: creature._id };
      if (!doc.parentId || doc.parentId === creature._id) delete doc.parentId;
      if (typeof doc.left !== 'number') { doc.left = Number.MAX_SAFE_INTEGER / 2; doc.right = doc.left + 1; }
      inserted.push(doc);
    } else if (op.deleteOne) {
      const id = op.deleteOne.filter?._id;
      if (id && stored.has(id)) deleted.add(id);
    }
  }
  if (inserted.length) assertRoomForProps(db, creature._id, inserted.length);
  // Inserted subtrees (applied buffs) go after everything else
  if (inserted.length) {
    const minLeft = Math.min(...inserted.map(d => d.left));
    for (const d of inserted) { d.left = Number.MAX_SAFE_INTEGER / 4 + (d.left - minLeft); d.right = Number.MAX_SAFE_INTEGER / 4 + (d.right - minLeft); }
  }
  tx(db, () => {
    for (const id of deleted) {
      // A removed buff takes its descendants with it
      const top = stored.get(id)!;
      for (const p of stored.values()) if (p.left >= top.left && p.right <= top.right) { q(db, 'DELETE FROM creature_properties WHERE id = ?').run(p._id); stored.delete(p._id); }
    }
    for (const id of touched) if (stored.has(id)) saveProp(db, creature._id, stored.get(id)!);
    if (inserted.length) {
      const all = [...stored.values(), ...inserted];
      rebuildNestedSets(all);
      for (const p of all) saveProp(db, creature._id, p);
    }
  });
  const content = outcome.log.filter((c: any) => !c.silenced).slice(0, 50).map((c: any) => ({
    name: String(c.name ?? '').slice(0, 200), value: c.value === undefined ? undefined : String(c.value).slice(0, 2000), inline: !!c.inline,
  }));
  if (content.length) addLog(db, current, content);
  await recompute(db, creature._id);
  return { status: 'done' as const, log: content };
}

export function addLog(db: DB, creature: Doc, content: any[]) {
  const log = { _id: newId(), creatureId: creature._id, creatureName: creature.name, date: now(), content };
  q(db, 'INSERT INTO creature_logs (id, creature_id, created_at, doc) VALUES (?, ?, ?, ?)').run(log._id, creature._id, log.date, JSON.stringify(log));
  // DiceCloud keeps the latest 100 log entries per creature
  q(db, `DELETE FROM creature_logs WHERE creature_id = ? AND id NOT IN (SELECT id FROM creature_logs WHERE creature_id = ? ORDER BY created_at DESC LIMIT 100)`).run(creature._id, creature._id);
  return log;
}


/**
 * One-time repair for characters built with DiceSheet before 0.1.10. When a chosen entry
 * contained library references (e.g. LoV's 2024 Tiefling, which references "+2 Charisma"),
 * the wrong node was attached to the slot: a node from inside a referenced entry went into
 * the slot, and the chosen entry itself ended up at the top level of the character.
 * Detects exactly that shape and swaps the two parents back. Returns the creature ids fixed.
 */
export function repairReferenceFills(db: DB): string[] {
  const fixed: string[] = [];
  const creatureIds = (q(db, 'SELECT id FROM creatures').all() as any[]).map(r => r.id);
  for (const creatureId of creatureIds) {
    const props = loadProps(db, creatureId);
    const byId = new Map(props.map(p => [p._id, p]));
    const orphans = props.filter(p => p.libraryNodeId && (!p.parentId || !byId.has(p.parentId)));
    if (!orphans.length) continue;
    const isUnder = (p: Doc, root: Doc) => { let cur: Doc | undefined = p; for (let i = 0; cur && i < 50; i++) { if (cur._id === root._id) return true; cur = cur.parentId ? byId.get(cur.parentId) : undefined; } return false; };
    let changed = false;
    for (const m of orphans) {
      const libM = getNode(db, m.libraryNodeId);
      if (!libM) continue;
      const refs = new Map<string, Doc>();
      for (const n of getDescendants(db, libM)) if (n.type === 'reference' && n.ref?.id) refs.set(n.ref.id, n);
      if (!refs.size) continue;
      // A node sitting directly in a slot whose library origin is inside one of M's references
      for (const e of props) {
        const slot = e.parentId ? byId.get(e.parentId) : undefined;
        if (!slot || (slot.type !== 'propertySlot' && slot.type !== 'class') || !e.libraryNodeId || e === m) continue;
        let lib = getNode(db, e.libraryNodeId), target: Doc | undefined, ref: Doc | undefined;
        const libE = lib;
        for (let i = 0; lib && i < 30; i++) {
          if (refs.has(lib._id)) { target = lib; ref = refs.get(lib._id); break; }
          lib = lib.parentId ? getNode(db, lib.parentId) : undefined;
        }
        if (!target || !ref || !libE) continue;
        // Where E really belongs: under the copy of its library parent (or of the reference's parent)
        const parentLibId = libE._id === target._id ? ref.parentId : libE.parentId;
        const newParent = parentLibId === libM._id ? m : props.find(p => p.libraryNodeId === parentLibId && p !== e && isUnder(p, m));
        if (!newParent) continue;
        e.parentId = newParent._id;
        m.parentId = slot._id;
        changed = true;
        break;
      }
    }
    if (changed) {
      tx(db, () => {
        rebuildNestedSets(props);
        for (const p of props) saveProp(db, creatureId, p);
      });
      fixed.push(creatureId);
    }
  }
  return fixed;
}
