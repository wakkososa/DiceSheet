import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sift from 'sift';
import { union } from 'lodash';
import { type DB, q, tx } from './db';
import { HttpError } from './settings';
import { type Doc, renewDocIds, newId } from '../engine/index';

// ---------------------------------------------------------------------------
// MongoDB extended JSON (mongoexport --jsonFormat=canonical/relaxed) -> plain JSON
// ---------------------------------------------------------------------------
export function fromEJSON(v: any): any {
  if (Array.isArray(v)) return v.map(fromEJSON);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const k = keys[0];
      if (k === '$numberInt' || k === '$numberDouble' || k === '$numberLong' || k === '$numberDecimal') return Number(v[k]);
      if (k === '$date') {
        const d = v[k];
        if (typeof d === 'string') return d;
        if (typeof d === 'number') return new Date(d).toISOString();
        if (d && d.$numberLong) return new Date(Number(d.$numberLong)).toISOString();
      }
      if (k === '$oid') return v[k];
    }
    const o: any = {};
    for (const k of keys) o[k] = fromEJSON(v[k]);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export type ImportInput = { libraries: Doc[], libraryNodes: Doc[], libraryCollections: Doc[] };

/** Read a mongoexport directory, a .tgz of one, or DiceCloud library JSON files. */
export function readLibraryExport(p: string): ImportInput {
  const out: ImportInput = { libraries: [], libraryNodes: [], libraryCollections: [] };
  const addFile = (name: string, text: string) => {
    const base = path.basename(name).replace(/\.(jsonl|json)$/, '');
    const docs = parseJsonOrJsonl(text);
    if (base in out) {
      (out as any)[base].push(...docs);
    } else {
      // export-library.js format: { library, nodes } or [{...}]
      for (const d of docs) {
        if (d.library && Array.isArray(d.nodes)) { out.libraries.push(d.library); out.libraryNodes.push(...d.nodes); }
        if (d.libraryCollection) out.libraryCollections.push(d.libraryCollection);
      }
    }
  };
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(p)) if (/\.(jsonl|json)$/.test(f)) addFile(f, fs.readFileSync(path.join(p, f), 'utf8'));
  } else if (/\.(tgz|tar\.gz)$/.test(p)) {
    for (const [name, buf] of untar(zlib.gunzipSync(fs.readFileSync(p)))) if (/\.(jsonl|json)$/.test(name)) addFile(name, buf.toString('utf8'));
  } else {
    addFile(p, fs.readFileSync(p, 'utf8'));
  }
  out.libraries = out.libraries.map(fromEJSON);
  out.libraryNodes = out.libraryNodes.map(fromEJSON);
  out.libraryCollections = out.libraryCollections.map(fromEJSON);
  return out;
}

function parseJsonOrJsonl(text: string): any[] {
  const t = text.trim();
  if (!t) return [];
  if (t[0] === '[') return JSON.parse(t);
  try { return [JSON.parse(t)]; } catch { /* jsonl */ }
  return t.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

/** Minimal ustar reader (enough for tar czf output). */
function untar(buf: Buffer): [string, Buffer][] {
  const files: [string, Buffer][] = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    off += 512;
    if (type === '0' || type === '\0') files.push([prefix ? prefix + '/' + name : name, buf.subarray(off, off + size)]);
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Make sure a node has v3 tree fields (root/left/right/parentId), deriving them from v2 fields if needed. */
function normalizeNode(n: Doc): Doc {
  if (!n.root && Array.isArray(n.ancestors) && n.ancestors[0]) n.root = { ...n.ancestors[0] };
  if (n.parentId === undefined && n.parent?.collection === 'libraryNodes') n.parentId = n.parent.id;
  return n;
}

export function importLibraries(db: DB, input: ImportInput) {
  const stats = { libraries: 0, collections: 0, nodes: 0, removedNodes: 0 };
  tx(db, () => {
    const libIds = new Set(input.libraries.map(l => l._id));
    // Nodes may arrive without their library doc (partial export); still import them.
    for (const n of input.libraryNodes) { normalizeNode(n); if (n.root?.id) libIds.add(n.root.id); }

    for (const lib of input.libraries) {
      q(db, 'INSERT INTO libraries (id, doc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc')
        .run(lib._id, JSON.stringify(lib));
      stats.libraries++;
    }
    for (const col of input.libraryCollections) {
      q(db, 'INSERT INTO library_collections (id, doc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc')
        .run(col._id, JSON.stringify(col));
      stats.collections++;
    }
    // Replace every node of each imported library, so nodes deleted upstream disappear too.
    for (const id of libIds) {
      stats.removedNodes += Number((q(db, 'DELETE FROM library_nodes WHERE library_id = ?').run(id) as any).changes);
    }
    const ins = q(db, 'INSERT OR REPLACE INTO library_nodes (id, library_id, lft, rgt, fill_slots, removed, doc) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const n of input.libraryNodes) {
      if (!n.root?.id) continue;
      if (typeof n.left !== 'number' || typeof n.right !== 'number') {
        throw new HttpError(400, `Library node ${n._id} has no left/right numbering; export from a DiceCloud server running schema v3 or newer`);
      }
      ins.run(n._id, n.root.id, n.left, n.right, n.fillSlots ? 1 : 0, n.removed ? 1 : 0, JSON.stringify(n));
      stats.nodes++;
    }
    stats.removedNodes = Math.max(0, stats.removedNodes - stats.nodes);
  });
  invalidateIndex();
  return stats;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function listLibraries(db: DB) {
  const counts = new Map((q(db, 'SELECT library_id, COUNT(*) n FROM library_nodes WHERE removed = 0 GROUP BY library_id').all() as any[])
    .map(r => [r.library_id, r.n]));
  return (q(db, 'SELECT doc FROM libraries').all() as any[]).map(r => {
    const l = JSON.parse(r.doc);
    return { _id: l._id, name: l.name, description: l.description, nodeCount: counts.get(l._id) || 0, updatedAt: l.dicesheetSync?.updatedAt, source: l.dicesheetSync?.source };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function listCollections(db: DB) {
  return (q(db, 'SELECT doc FROM library_collections').all() as any[]).map(r => {
    const c = JSON.parse(r.doc);
    return { _id: c._id, name: c.name, description: c.description, libraries: c.libraries || [], updatedAt: c.dicesheetSync?.updatedAt };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function renameCollection(db: DB, id: string, name: unknown) {
  updateCollection(db, id, { name });
}

/** Library collections are local (DiceCloud doesn't share them anonymously); admins edit them here. */
export function updateCollection(db: DB, id: string, input: { name?: unknown, libraries?: unknown }) {
  const row = q(db, 'SELECT doc FROM library_collections WHERE id = ?').get(id) as any;
  if (!row) throw new HttpError(404, 'Collection not found');
  const doc = JSON.parse(row.doc);
  Object.assign(doc, validateCollection(db, input, doc));
  q(db, 'UPDATE library_collections SET doc = ? WHERE id = ?').run(JSON.stringify(doc), id);
  return doc;
}

export function createCollection(db: DB, input: { name?: unknown, libraries?: unknown }) {
  const doc = { _id: newId(), readers: [], writers: [], public: true, ...validateCollection(db, { libraries: [], ...input }, {}) };
  if (!doc.name) throw new HttpError(400, 'Name the collection');
  q(db, 'INSERT INTO library_collections (id, doc) VALUES (?, ?)').run(doc._id, JSON.stringify(doc));
  return doc;
}

export function deleteCollection(db: DB, id: string) {
  q(db, 'DELETE FROM library_collections WHERE id = ?').run(id);
}

function validateCollection(db: DB, input: { name?: unknown, libraries?: unknown }, current: any) {
  const out: any = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new HttpError(400, 'Name must be 1-100 characters');
    out.name = input.name.trim();
  } else if (!current.name) out.name = undefined;
  if (input.libraries !== undefined) {
    const known = new Set(listLibraries(db).map(l => l._id));
    if (!Array.isArray(input.libraries) || !input.libraries.every(i => typeof i === 'string' && known.has(i))) throw new HttpError(400, 'Unknown library in collection');
    out.libraries = [...new Set(input.libraries as string[])];
  }
  return out;
}

/** Remove a library and its entries. Characters keep their copies of anything already added. */
export function deleteLibrary(db: DB, id: string) {
  tx(db, () => {
    q(db, 'DELETE FROM library_nodes WHERE library_id = ?').run(id);
    q(db, 'DELETE FROM libraries WHERE id = ?').run(id);
    for (const c of listCollections(db)) {
      if (c.libraries.includes(id)) updateCollection(db, c._id, { libraries: c.libraries.filter((l: string) => l !== id) });
    }
  });
  invalidateIndex();
}

export function getNode(db: DB, id: string): Doc | undefined {
  const r = q(db, 'SELECT doc FROM library_nodes WHERE id = ? AND removed = 0').get(id) as any;
  return r && JSON.parse(r.doc);
}

/** All non-removed descendants of a node, in tree order. */
export function getDescendants(db: DB, node: Doc): Doc[] {
  return (q(db, 'SELECT doc FROM library_nodes WHERE library_id = ? AND lft > ? AND rgt < ? AND removed = 0 ORDER BY lft')
    .all(node.root.id, node.left, node.right) as any[]).map(r => JSON.parse(r.doc));
}

/** The library ids a character may draw from (DiceCloud's getCreatureLibraryIds, minus per-user subscriptions). */
export function creatureLibraryIds(db: DB, creature: Doc): string[] {
  const all = listLibraries(db).map(l => l._id);
  const { allowedLibraries, allowedLibraryCollections } = creature;
  if (!allowedLibraries && !allowedLibraryCollections) return all;
  let ids: string[] = allowedLibraries || [];
  for (const c of listCollections(db)) if ((allowedLibraryCollections || []).includes(c._id)) ids = union(ids, c.libraries);
  return all.filter(id => ids.includes(id));
}

// ---------------------------------------------------------------------------
// Slot filler index: the ~11k nodes with fillSlots, trimmed to the fields
// DiceCloud's getSlotFillFilter and the slot dialog use. Kept in memory.
// ---------------------------------------------------------------------------
const INDEX_FIELDS = ['_id', 'root', 'type', 'name', 'fillSlots', 'removed', 'slotFillerType', 'libraryTags', 'tags',
  'variableName', 'level', 'cache', 'order', 'left', 'slotFillerCondition', 'slotFillerConditionNote',
  'slotQuantityFilled', 'color', 'summary', 'description', 'ref'];
let index: Doc[] | undefined;

export function invalidateLibraryIndex() { index = undefined; }
const invalidateIndex = invalidateLibraryIndex;

function getIndex(db: DB): Doc[] {
  if (index) return index;
  index = (q(db, 'SELECT doc FROM library_nodes WHERE fill_slots = 1 AND removed = 0').all() as any[]).map(r => {
    const n = JSON.parse(r.doc);
    const o: any = {};
    for (const k of INDEX_FIELDS) if (n[k] !== undefined) o[k] = n[k];
    if (o.cache?.node) o.cache = { node: pickNode(o.cache.node) };
    if (n.icon?.name) o.icon = { name: n.icon.name };
    // Descriptions can be long; keep a short preview for the picker
    for (const k of ['summary', 'description']) {
      if (o[k]?.text) o[k] = { text: String(o[k].value ?? o[k].text).slice(0, 600) };
    }
    return o;
  });
  return index;
}

function pickNode(n: any) {
  const { name, level, type, slotFillerType, variableName, libraryTags } = n;
  return { name, level, type, slotFillerType, variableName, libraryTags };
}

export type SlotFillerQuery = { filter: any, search?: string, limit?: number, offset?: number };

/** Run a DiceCloud slot filter (MongoDB query syntax) against the in-memory index. */
export function findSlotFillers(db: DB, { filter, search, limit = 200, offset = 0 }: SlotFillerQuery) {
  const test = sift(filter);
  let nodes = getIndex(db).filter(n => test(n));
  if (search) {
    const s = search.toLowerCase();
    nodes = nodes.filter(n => (n.name || n.cache?.node?.name || '').toLowerCase().includes(s) || (n.libraryTags || []).includes(search));
  }
  nodes.sort((a, b) => {
    const an = a.cache?.node?.name ?? a.name ?? '', bn = b.cache?.node?.name ?? b.name ?? '';
    return an.localeCompare(bn) || (a.order ?? 0) - (b.order ?? 0);
  });
  return { total: nodes.length, nodes: nodes.slice(offset, offset + limit) };
}

// ---------------------------------------------------------------------------
// Insert library nodes into a creature (DiceCloud insertPropertyFromLibraryNode,
// including the fix for root/parentId that upstream develop is missing).
// ---------------------------------------------------------------------------
export function copyNodesForCreature(db: DB, nodeIds: string[], creatureId: string, parentId: string | undefined): Doc[] {
  const root = { collection: 'creatures', id: creatureId };
  const out: Doc[] = [];
  for (const nodeId of nodeIds) {
    const node = getNode(db, nodeId);
    if (!node) throw new HttpError(404, `No library entry with id '${nodeId}'`);
    let nodes: Doc[] = [node, ...getDescendants(db, node)];
    nodes = reifyNodeReferences(db, nodes);
    // The top is the chosen entry (or, if it was a reference, what it points to, which takes its id)
    const top = nodes.find(n => n._id === node._id) || nodes[0];
    // References leave fractional numbers; turn every left/right into whole-number ranks so
    // nothing ties once the subtree is shifted to the (very large) end of the creature's list.
    const ends = [...new Set(nodes.flatMap(n => [n.left, n.right]))].sort((x, y) => x - y);
    const rank = new Map(ends.map((v, i) => [v, i + 1]));
    for (const n of nodes) { n.left = rank.get(n.left)!; n.right = rank.get(n.right)!; }
    nodes.forEach(n => { if (!n.libraryNodeId) n.libraryNodeId = n._id; });
    renewDocIds({ docArray: nodes, collectionMap: { libraryNodes: 'creatureProperties' } });
    for (const n of nodes) {
      n.root = { ...root };
      delete n.ancestors; delete n.parent; delete n.order;
    }
    // Attach to the creature: the copied top node goes under the requested parent
    top.parentId = parentId && parentId !== creatureId ? parentId : undefined;
    if (top.parentId === undefined) delete top.parentId;
    top.dirty = true;
    // Keep the copied subtree's relative order but place it after everything else
    const base = 2 ** 50; // a whole number with exact integer spacing (MAX_SAFE_INTEGER / 2 ends in .5 and rounds)
    const offset = base - top.left;
    for (const n of nodes) { n.left += offset; n.right += offset; }
    out.push(...nodes);
  }
  return out;
}

function reifyNodeReferences(db: DB, nodes: Doc[], visited = new Set<string>(), depth = 0): Doc[] {
  depth += 1;
  const added: Doc[] = [];
  const result = nodes.filter(node => {
    if (node.type !== 'reference') return true;
    if (depth >= 10) { node.cache = { error: 'Reference depth limit exceeded' }; return true; }
    const referenced = node.ref?.id ? getNode(db, node.ref.id) : undefined;
    if (!referenced) { node.cache = { error: 'Referenced library entry not found' }; return true; }
    referenced.tags = union(node.tags, referenced.tags);
    visited.add(node._id);
    // The referenced subtree takes the reference node's place in the tree
    referenced.parentId = node.parentId;
    let sub = [referenced, ...getDescendants(db, referenced)].filter(n => {
      if (n.type !== 'reference') return true;
      if (visited.has(n._id)) return false;
      visited.add(n._id);
      return true;
    });
    sub.forEach(n => { if (!n.libraryNodeId) n.libraryNodeId = n._id; });
    // Fit the referenced subtree's numbering inside the reference node's slot. Read the
    // referenced node's own numbers first: it is the first node rewritten in the loop.
    const refLeft = referenced.left, refRight = referenced.right;
    const scale = Math.max(1, refRight - refLeft);
    const width = Math.max(1, node.right - node.left);
    for (const n of sub) {
      n.left = node.left + ((n.left - refLeft) / scale) * width * 0.999 + 0.0001;
      n.right = node.left + ((n.right - refLeft) / scale) * width * 0.999 + 0.0001;
    }
    renewDocIds({ docArray: sub, idMap: { [referenced._id]: node._id } });
    sub = reifyNodeReferences(db, sub, visited, depth);
    added.push(...sub);
    return false;
  });
  result.push(...added);
  return result.sort((a, b) => a.left - b.left);
}

export { newId };
