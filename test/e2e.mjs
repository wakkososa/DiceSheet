// End-to-end API test. Usage: node test/e2e.mjs <baseUrl> <setupToken> <character.json>
import fs from 'node:fs';
import assert from 'node:assert/strict';

const [base, setupToken, charFile] = process.argv.slice(2);
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

function client() {
  let cookie = '';
  async function req(method, path, body, { raw = false, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dicesheet', ...(cookie && { cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = raw ? await res.text() : await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers };
  }
  return { req, get: p => req('GET', p), post: (p, b) => req('POST', p, b ?? {}), patch: (p, b) => req('PATCH', p, b), del: p => req('DELETE', p, undefined) };
}

const admin = client();
console.log('auth');
let r = await admin.post('/api/setup', { setupToken: 'wrong', username: 'admin', password: 'correct horse' });
assert.equal(r.status, 403); ok('setup rejects wrong token');
r = await admin.post('/api/setup', { setupToken, username: 'admin', password: 'correct horse' });
assert.equal(r.status, 200); assert.equal(r.data.user.isAdmin, true); ok('setup creates admin and logs in');
r = await admin.post('/api/setup', { setupToken, username: 'admin2', password: 'correct horse' });
assert.equal(r.status, 400); ok('setup cannot be repeated');

const anon = client();
r = await anon.get('/api/characters'); assert.equal(r.status, 401); ok('anonymous requests are refused');
r = await anon.post('/api/register', { username: 'bob', password: 'password123' }); assert.equal(r.status, 403); ok('registration closed by default');
r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct horse' }) });
assert.equal(r.status, 403); ok('requests without the CSRF header are refused');
r = await anon.req('POST', '/api/login', { username: 'admin', password: 'correct horse' }, { headers: { origin: 'https://evil.example' } });
assert.equal(r.status, 403); ok('cross-origin requests are refused');
r = await anon.post('/api/login', { username: 'admin', password: 'nope-nope' }); assert.equal(r.status, 401); ok('wrong password refused');

console.log('admin');
r = await admin.patch('/api/admin/settings', { defaultCharacterLimit: 0 }); assert.equal(r.status, 400); ok('limit 0 rejected');
r = await admin.patch('/api/admin/settings', { defaultCharacterLimit: 1000 }); assert.equal(r.status, 400); ok('limit 1000 rejected');
r = await admin.patch('/api/admin/settings', { defaultCharacterLimit: 2.5 }); assert.equal(r.status, 400); ok('fractional limit rejected');
r = await admin.patch('/api/admin/settings', { defaultCharacterLimit: 999 }); assert.equal(r.status, 200); assert.equal(r.data.defaultCharacterLimit, 999); ok('limit 999 accepted');
r = await admin.patch('/api/admin/settings', { defaultCharacterLimit: 5, registrationOpen: true }); assert.equal(r.data.registrationOpen, true); ok('registration opened');
const bob = client();
r = await bob.post('/api/register', { username: 'bob', password: 'password123' }); assert.equal(r.status, 200); ok('user can register when open');
r = await bob.get('/api/admin/users'); assert.equal(r.status, 403); ok('non-admin blocked from admin API');
r = await admin.patch('/api/admin/settings', { registrationOpen: false });
r = await client().post('/api/register', { username: 'carol', password: 'password123' }); assert.equal(r.status, 403); ok('registration closed again');
r = await admin.post('/api/admin/users', { username: 'dave', password: 'password123', characterLimit: 1 }); assert.equal(r.status, 200); ok('admin creates user with limit 1');
const daveId = r.data.user.id;
r = await admin.post('/api/admin/users', { username: 'erin', password: 'password123', characterLimit: 1000 }); assert.equal(r.status, 400); ok('admin cannot create user with limit 1000');

console.log('characters');
const archive = JSON.parse(fs.readFileSync(charFile, 'utf8'));
let t = Date.now();
r = await admin.post('/api/characters/import', archive);
assert.equal(r.status, 200, JSON.stringify(r.data)); const charId = r.data.id;
ok(`imported ${archive.creature.name} (${Date.now() - t} ms)`);
r = await admin.get('/api/characters/' + charId);
const view = r.data;
assert.equal(view.properties.length, archive.properties.filter(p => !p.removed).length);
const byVar = Object.fromEntries(view.properties.filter(p => p.variableName).map(p => [p.variableName, p]));
const origVar = Object.fromEntries(archive.properties.filter(p => p.variableName && !p.removed).map(p => [p.variableName, p]));
for (const v of ['strength', 'dexterity', 'constitution', 'wisdom', 'hitPoints', 'armor', 'proficiencyBonus', 'level']) {
  if (!origVar[v]) continue;
  assert.equal(byVar[v]?.value, origVar[v].value, v);
}
ok(`stats match dicecloud.com: STR ${byVar.strength.value} DEX ${byVar.dexterity.value} HP ${byVar.hitPoints?.value} AC ${byVar.armor?.value} level ${view.variables.level?.value}`);
assert.equal(view.variables.showPHB2024?.value, true); ok('showPHB2024 is stored with its value (old bug fixed)');

r = await bob.get('/api/characters/' + charId); assert.equal(r.status, 404); ok("other users can't see the character");

// Slot filling
const slots = view.properties.filter(p => p.type === 'propertySlot' && !p.inactive && p.spaceLeft > 0);
ok(`${slots.length} open slots on the character`);
let tested = 0, filled = false;
for (const slot of slots) {
  r = await admin.get(`/api/characters/${charId}/slots/${slot._id}/fillers`);
  assert.equal(r.status, 200);
  if (!r.data.total) continue;
  tested++;
  const met = r.data.results.filter(x => x.requirementMet && !x.alreadyAdded && !x.tooBig);
  const unmet = r.data.results.filter(x => !x.requirementMet);
  if (tested <= 4) console.log(`    slot "${slot.name}": ${r.data.total} options, ${met.length} available, ${unmet.length} unmet` + (unmet[0] ? ` e.g. "${unmet[0].name}" -> ${unmet[0].requirementNote || unmet[0].requirementError}` : ''));
  if (!filled && met.length) {
    const before = (await admin.get('/api/characters/' + charId)).data.properties.length;
    r = await admin.post(`/api/characters/${charId}/slots/${slot._id}/fill`, { nodeIds: [met[0]._id] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.properties.length > before);
    const inserted = r.data.properties.find(p => p._id === r.data.insertedIds[0]);
    assert.equal(inserted.parentId, slot._id); assert.equal(inserted.root.id, charId);
    ok(`filled "${slot.name}" with "${met[0].name}" (+${r.data.properties.length - before} properties, attached to slot)`);
    filled = true;
  }
  if (unmet.length) {
    r = await admin.post(`/api/characters/${charId}/slots/${slot._id}/fill`, { nodeIds: [unmet[0]._id] });
    assert.equal(r.status, 400); ok(`unmet requirement blocked: ${r.data.error}`);
    break;
  }
}

// Level up (class slot)
const cls = view.properties.find(p => p.type === 'class');
if (cls) {
  r = await admin.get(`/api/characters/${charId}/slots/${cls._id}/fillers`);
  assert.equal(r.status, 200);
  const lv = r.data.results.filter(x => x.requirementMet).map(x => `${x.name}${x.level ? ' (' + x.level + ')' : ''}`).slice(0, 3);
  ok(`level up "${cls.name}" (level ${cls.level}): ${r.data.total} options, e.g. ${lv.join(', ')}`);
  const lvl = x => x.level ?? x.cache?.node?.level;
  const pickFor = L => r.data.results.find(x => lvl(x) === L && x.requirementMet && x.libraryName === r.data.results.find(y => lvl(y) === cls.level + 1)?.libraryName) || r.data.results.find(x => lvl(x) === L && x.requirementMet);
  const ten = pickFor(cls.level + 1), eleven = pickFor(cls.level + 2);
  const before = (await admin.get('/api/characters/' + charId)).data;
  const hpBefore = before.properties.find(p => p.variableName === 'hitPoints').total;
  r = await admin.post(`/api/characters/${charId}/slots/${cls._id}/fill`, { nodeIds: [eleven._id, ten._id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = r.data;
  assert.equal(after.variables.level.value, before.variables.level.value + 2);
  const hpAfter = after.properties.find(p => p.variableName === 'hitPoints').total;
  assert.ok(hpAfter > hpBefore, `HP ${hpBefore} -> ${hpAfter}`);
  ok(`levelled up twice: level ${before.variables.level.value} -> ${after.variables.level.value}, max HP ${hpBefore} -> ${hpAfter}`);
  r = await admin.post(`/api/characters/${charId}/slots/${cls._id}/fill`, { nodeIds: [ten._id] });
  assert.equal(r.status, 400); ok(`same level can't be added twice: ${r.data.error}`);
}

// HP adjust
const hp = (await admin.get('/api/characters/' + charId)).data.properties.find(p => p.variableName === 'hitPoints');
r = await admin.post(`/api/characters/${charId}/properties/${hp._id}/adjust`, { operation: 'increment', value: 5 });
let hp2 = r.data.properties.find(p => p._id === hp._id);
assert.equal(hp2.value, hp.value - 5); ok(`took 5 damage: HP ${hp.value} -> ${hp2.value}`);
r = await admin.post(`/api/characters/${charId}/properties/${hp._id}/adjust`, { operation: 'increment', value: -999 });
hp2 = r.data.properties.find(p => p._id === hp._id);
assert.equal(hp2.value, hp.total); ok('healing clamps to max HP');

// Rests: spend a resource and HP, then long rest restores them
{
  const v = (await admin.get('/api/characters/' + charId)).data;
  const res = v.properties.find(p => p.type === 'attribute' && p.reset === 'longRest' && p.attributeType === 'resource' && p.total > 0 && !p.inactive);
  const hd = v.properties.find(p => p.type === 'attribute' && p.attributeType === 'hitDice' && !p.inactive);
  await admin.post(`/api/characters/${charId}/properties/${res._id}/adjust`, { operation: 'increment', value: 1 });
  await admin.post(`/api/characters/${charId}/properties/${hd._id}/adjust`, { operation: 'increment', value: hd.total });
  r = await admin.post(`/api/characters/${charId}/rest`, { type: 'shortRest' });
  assert.equal(r.data.properties.find(p => p._id === res._id).value, res.total - 1); ok(`short rest leaves long-rest resource "${res.name}" spent`);
  r = await admin.post(`/api/characters/${charId}/rest`, { type: 'longRest' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.properties.find(p => p._id === res._id).value, res.total);
  const hdAfter = r.data.properties.find(p => p._id === hd._id).value;
  assert.equal(hdAfter, Math.max(Math.floor(hd.total / 2), 1));
  ok(`long rest restores "${res.name}" and recovers half the hit dice (0 -> ${hdAfter} of ${hd.total})`);
}

// Export
r = await admin.req('GET', `/api/characters/${charId}/export?version=3`, undefined, { raw: true });
const v3 = JSON.parse(r.data); assert.equal(v3.meta.schemaVersion, 3); assert.ok(v3.properties.every(p => p.root && 'left' in p)); ok('export v3');
r = await admin.req('GET', `/api/characters/${charId}/export?version=2`, undefined, { raw: true });
const v2 = JSON.parse(r.data); assert.equal(v2.meta.schemaVersion, 2);
assert.ok(v2.properties.every(p => Array.isArray(p.ancestors) && p.parent && typeof p.order === 'number' && !('left' in p)));
// v2 export of untouched props must keep their original ancestry
const origById = Object.fromEntries(archive.properties.map(p => [p._id, p]));
let same = 0, compared = 0;
for (const p of v2.properties) { const o = origById[p._id]; if (!o || o.removed) continue; compared++; const ids = a => a.map(x => x.collection + ':' + x.id).join('/'); if (ids(o.ancestors) === ids(p.ancestors) && o.parent.id === p.parent.id && o.parent.collection === p.parent.collection) same++; else if (compared - same < 3) console.log('    differs:', p.name, ids(o.ancestors), '=>', ids(p.ancestors)); }
assert.equal(same, compared); ok(`export v2 (dicecloud.com format): ${same}/${compared} original properties keep identical ancestry`);

// Re-import of an export (round trip) works and gets fresh ids
r = await admin.post('/api/characters/import', v2); assert.equal(r.status, 200); assert.notEqual(r.data.id, charId); ok('re-importing the v2 export creates a copy with new ids');

// Character limit enforcement
const dave = client();
await dave.post('/api/login', { username: 'dave', password: 'password123' });
r = await dave.post('/api/characters', { name: 'First' }); assert.equal(r.status, 200, JSON.stringify(r.data)); ok('dave creates 1 character');
r = await dave.post('/api/characters', { name: 'Second' }); assert.equal(r.status, 403); ok(`limit enforced: ${r.data.error}`);
r = await dave.post('/api/characters/import', archive); assert.equal(r.status, 403); ok('limit also enforced on import');
r = await admin.patch('/api/admin/users/' + daveId, { characterLimit: 2 });
r = await dave.post('/api/characters', { name: 'Second' }); assert.equal(r.status, 200); ok('raising the limit allows another');

// New character with a library collection gets the ruleset slot
const cols = (await admin.get('/api/libraries')).data.collections;
r = await admin.post('/api/characters', { name: 'Fresh 2024', allowedLibraryCollections: [cols[0]._id], startingLevel: 1 });
assert.equal(r.status, 200, JSON.stringify(r.data));
const fresh = (await admin.get('/api/characters/' + r.data.id)).data;
const ruleset = fresh.properties.find(p => p.name === 'Ruleset');
r = await admin.get(`/api/characters/${fresh.creature._id}/slots/${ruleset._id}/fillers`);
ok(`new character restricted to "${cols[0].name}": ${r.data.total} rulesets offered (${r.data.results.map(x => x.name).slice(0, 3).join(', ')})`);

console.log(`\n${passed} checks passed`);
