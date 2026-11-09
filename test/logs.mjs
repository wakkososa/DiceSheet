// Admin → Logs, and checks that library updates are gone (import-only fork).
// Usage: node test/logs.mjs <baseUrl> <adminUser> <adminPass>
import assert from 'node:assert/strict';
const [base, username, password] = process.argv.slice(2);
const ok = m => console.log('  ✓', m);
const client = () => {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'dicesheet', ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
};
const req = client();
await req('POST', '/api/login', { username, password });

// 0.1.18b: libraries are import-only, so the dicecloud.com update endpoints are gone
for (const [m, path] of [['GET', '/api/admin/libraries/sync'], ['POST', '/api/admin/libraries/sync'], ['POST', '/api/admin/libraries/sync/cancel']]) {
  const res = await req(m, path, m === 'POST' ? {} : undefined);
  assert.equal(res.status, 404, `${m} ${path} should be gone`);
}
ok('library update endpoints answer 404');
let r = await req('POST', '/api/admin/libraries/import', {}); assert.notEqual(r.status, 404); ok('library file import endpoint is still there');

// Logs
r = await req('GET', '/api/admin/logs');
assert.equal(r.status, 200);
const lines = r.data.entries.map(e => `[${e.category}] ${e.message}`);
for (const re of [/\[auth\] signed in: /]) assert.ok(lines.some(l => re.test(l)), `log has ${re}`);
ok(`log has the sign-in line (${r.data.entries.length} lines)`);
const lastSeq = r.data.last;
r = await req('GET', `/api/admin/logs?after=${lastSeq}`); assert.equal(r.data.entries.length, 0); ok('?after= returns only newer lines');
const bad = client();
await bad('POST', '/api/login', { username, password: 'definitely wrong' });
r = await req('GET', `/api/admin/logs?after=${lastSeq}`);
assert.ok(r.data.entries.some(e => e.level === 'warn' && /failed sign-in for "/.test(e.message)) && !r.data.entries.some(e => /definitely wrong/.test(e.message)));
ok('a failed sign-in is logged as a warning, without the password');

// Not for regular users
await req('POST', '/api/admin/users', { username: 'logguest', password: 'guest password 1' });
const g = client(); await g('POST', '/api/login', { username: 'logguest', password: 'guest password 1' });
assert.equal((await g('GET', '/api/admin/logs')).status, 403);
assert.equal((await g('POST', '/api/admin/libraries/import', {})).status, 403); ok('players can’t read logs or import libraries');
const u = (await req('GET', '/api/admin/users')).data.users.find(x => x.username === 'logguest'); await req('DELETE', `/api/admin/users/${u.id}`);
console.log('logs test passed');
