/** Character folders: each user's own way to group their character list. */
import { type DB, q, now } from './db';
import { HttpError } from './settings';
import { type User } from './auth';
import { newId } from '../engine';

const MAX_FOLDERS = 100;

export type Folder = { _id: string, name: string, collapsed: boolean };

export function listFolders(db: DB, user: User): Folder[] {
  return (q(db, 'SELECT id, name, collapsed FROM creature_folders WHERE owner_id = ?').all(user.id) as any[])
    .map(r => ({ _id: r.id, name: r.name, collapsed: !!r.collapsed }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function folderName(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 60) throw new HttpError(400, 'Folder names are 1–60 characters');
  return v.trim();
}

function ownFolder(db: DB, user: User, id: string) {
  const row = q(db, 'SELECT id FROM creature_folders WHERE id = ? AND owner_id = ?').get(id, user.id);
  if (!row) throw new HttpError(404, 'Folder not found');
}

export function createFolder(db: DB, user: User, input: any): Folder {
  const name = folderName(input?.name);
  const n = (q(db, 'SELECT COUNT(*) n FROM creature_folders WHERE owner_id = ?').get(user.id) as any).n;
  if (n >= MAX_FOLDERS) throw new HttpError(400, `You can have up to ${MAX_FOLDERS} folders`);
  const id = newId();
  q(db, 'INSERT INTO creature_folders (id, owner_id, name, collapsed, created_at) VALUES (?, ?, ?, 0, ?)').run(id, user.id, name, now());
  return { _id: id, name, collapsed: false };
}

export function updateFolder(db: DB, user: User, id: string, input: any) {
  ownFolder(db, user, id);
  if (input?.name !== undefined) q(db, 'UPDATE creature_folders SET name = ? WHERE id = ?').run(folderName(input.name), id);
  if (input?.collapsed !== undefined) q(db, 'UPDATE creature_folders SET collapsed = ? WHERE id = ?').run(input.collapsed ? 1 : 0, id);
}

/** Deleting a folder never deletes characters: they move back out to the main list. */
export function deleteFolder(db: DB, user: User, id: string) {
  ownFolder(db, user, id);
  q(db, 'UPDATE creatures SET folder_id = NULL WHERE folder_id = ?').run(id);
  q(db, 'DELETE FROM creature_folders WHERE id = ?').run(id);
}

/** Put one of your own characters in one of your folders (null = no folder). */
export function moveCharacter(db: DB, user: User, creatureId: string, folderId: unknown) {
  const row = q(db, 'SELECT owner_id FROM creatures WHERE id = ?').get(creatureId) as any;
  if (!row || row.owner_id !== user.id) throw new HttpError(404, 'Character not found');
  if (folderId !== null && folderId !== undefined && folderId !== '') {
    if (typeof folderId !== 'string') throw new HttpError(400, 'Bad folder');
    ownFolder(db, user, folderId);
  }
  q(db, 'UPDATE creatures SET folder_id = ? WHERE id = ?').run(folderId || null, creatureId);
}
