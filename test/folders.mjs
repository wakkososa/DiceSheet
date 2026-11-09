// Character folders test. Usage: node test/folders.mjs <baseUrl> <adminUser> <adminPass>
import assert from 'node:assert/strict';
const [base, username, password] = process.argv.slice(2);
const client = () => {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'dicesheet', ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
};
const ok = m => console.log('  ✓', m);
const a = client();
await a('POST', '/api/login', { username, password });
// Start clean: remove folders and the guest user left by an earlier run on this database
for (const f of (await a('GET', '/api/characters')).data.folders || []) await a('DELETE', `/api/folders/${f._id}`);
for (const u of (await a('GET', '/api/admin/users')).data.users || []) if (u.username === 'folderguest') await a('DELETE', `/api/admin/users/${u.id}`);
let r = await a('GET', '/api/characters');
assert.ok(Array.isArray(r.data.folders)); const chars = r.data.characters; assert.ok(chars.length >= 2);
assert.ok(chars.every(c => c.folderId === null)); ok(`existing characters start outside folders (${chars.length})`);

r = await a('POST', '/api/folders', { name: '  Strahd campaign ' }); assert.equal(r.status, 200); const f1 = r.data;
assert.equal(f1.name, 'Strahd campaign'); ok('folder created, name trimmed');
r = await a('POST', '/api/folders', { name: '' }); assert.equal(r.status, 400);
r = await a('POST', '/api/folders', { name: 'x'.repeat(61) }); assert.equal(r.status, 400); ok('empty and too-long names rejected');
const f2 = (await a('POST', '/api/folders', { name: 'Archive' })).data;

r = await a('PUT', `/api/characters/${chars[0]._id}/folder`, { folderId: f1._id }); assert.equal(r.status, 200);
r = await a('PUT', `/api/characters/${chars[1]._id}/folder`, { folderId: f2._id }); assert.equal(r.status, 200);
r = await a('GET', '/api/characters');
assert.equal(r.data.characters.find(c => c._id === chars[0]._id).folderId, f1._id);
assert.deepEqual(r.data.folders.map(f => f.name), ['Archive', 'Strahd campaign']); ok('characters moved; folders listed A–Z');

r = await a('PATCH', `/api/folders/${f1._id}`, { name: 'Curse of Strahd', collapsed: true }); assert.equal(r.status, 200);
r = await a('GET', '/api/characters'); const g = r.data.folders.find(f => f._id === f1._id);
assert.equal(g.name, 'Curse of Strahd'); assert.equal(g.collapsed, true); ok('rename and collapse saved');

// Another user can't see or use these folders
await a('POST', '/api/admin/users', { username: 'folderguest', password: 'guest password 1' });
const b = client(); await b('POST', '/api/login', { username: 'folderguest', password: 'guest password 1' });
r = await b('GET', '/api/characters'); assert.equal(r.data.folders.length, 0); ok("other users don't see your folders");
r = await b('PATCH', `/api/folders/${f1._id}`, { name: 'hacked' }); assert.equal(r.status, 404);
r = await b('DELETE', `/api/folders/${f1._id}`); assert.equal(r.status, 404);
r = await b('PUT', `/api/characters/${chars[0]._id}/folder`, { folderId: null }); assert.equal(r.status, 404);
const bf = (await b('POST', '/api/folders', { name: 'Mine' })).data;
r = await a('PUT', `/api/characters/${chars[0]._id}/folder`, { folderId: bf._id }); assert.equal(r.status, 404); ok("can't rename, delete or move into someone else's folder");
r = await a('PUT', `/api/characters/${chars[0]._id}/folder`, { folderId: 'nope' }); assert.equal(r.status, 404);

// Deleting a folder keeps its characters
r = await a('DELETE', `/api/folders/${f1._id}`); assert.equal(r.status, 200);
r = await a('GET', '/api/characters');
const back = r.data.characters.find(c => c._id === chars[0]._id);
assert.ok(back); assert.equal(back.folderId, null); assert.equal(r.data.characters.length, chars.length); ok('deleting a folder keeps its characters (moved back out)');
r = await a('PUT', `/api/characters/${chars[1]._id}/folder`, { folderId: null }); assert.equal(r.status, 200); ok('moved back out of a folder');
console.log('folders test passed');
