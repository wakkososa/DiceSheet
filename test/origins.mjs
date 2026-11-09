// Other addresses (e.g. a Cloudflare Worker in front of DiceSheet) and CORS.
// Usage: node test/origins.mjs <baseUrl> <adminUser> <adminPass>
import assert from 'node:assert/strict';
const [base, username, password] = process.argv.slice(2);
const ok = m => console.log('  ✓', m);
let cookie = '';
const req = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'dicesheet', ...(cookie && { cookie }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
};
const WORKER = 'https://dicesheet.tester.workers.dev';
const login = origin => req('POST', '/api/login', { username, password }, { origin });

await req('POST', '/api/login', { username, password });
await req('PATCH', '/api/admin/settings', { allowedOrigins: [] });
cookie = '';
let r = await login(WORKER);
assert.equal(r.status, 403); assert.match(r.data.error, /Cross-origin request blocked/); assert.match(r.data.error, /Other addresses/);
ok('sign-in through an unlisted Worker address is blocked, and the error says how to allow it');
r = await req('OPTIONS', '/api/login', undefined, { origin: WORKER, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-requested-with' });
assert.equal(r.status, 403); assert.equal(r.headers.get('access-control-allow-origin'), null); ok('preflight from an unlisted address is refused');

r = await login(''); // same-origin sign-in still works
assert.equal(r.status, 200);
r = await req('PATCH', '/api/admin/settings', { allowedOrigins: 'https://*.workers.dev' });
assert.equal(r.status, 400); assert.match(r.data.error, /too broad/); ok('"https://*.workers.dev" is refused as too broad');
r = await req('PATCH', '/api/admin/settings', { allowedOrigins: 'https://*.com' });
assert.equal(r.status, 400); ok('"https://*.com" is refused');
r = await req('PATCH', '/api/admin/settings', { allowedOrigins: 'https://*.mydomain.com' });
assert.equal(r.status, 200); ok('"https://*.mydomain.com" (a domain you own) is accepted');
r = await req('PATCH', '/api/admin/settings', { allowedOrigins: 'https://example.com/path' });
assert.equal(r.status, 400); ok('addresses with a path are refused');
r = await req('PATCH', '/api/admin/settings', { allowedOrigins: `${WORKER}/ \n https://Other.Example.org` });
assert.equal(r.status, 200); assert.deepEqual(r.data.allowedOrigins, [WORKER, 'https://other.example.org']); ok('addresses saved (trimmed, lower-cased)');

cookie = '';
r = await login(WORKER);
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.headers.get('access-control-allow-origin'), WORKER);
assert.equal(r.headers.get('access-control-allow-credentials'), 'true'); ok('sign-in through the listed Worker works (with CORS headers)');
r = await req('GET', '/api/characters', undefined, { origin: WORKER });
assert.equal(r.status, 200); assert.ok(Array.isArray(r.data.characters)); ok('signed-in requests through the Worker work');
r = await req('OPTIONS', '/api/characters', undefined, { origin: WORKER, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type,x-requested-with' });
assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), WORKER);
assert.match(r.headers.get('access-control-allow-headers'), /x-requested-with/); ok('preflight from the listed address is approved');
r = await req('GET', '/api/characters', undefined, { origin: 'https://evil.example.net' });
assert.equal(r.headers.get('access-control-allow-origin'), null); ok('other sites still get no CORS access');
r = await req('POST', '/api/logout', {}, { origin: 'https://dicesheet.tester.workers.dev.evil.net' });
assert.equal(r.status, 403); ok('look-alike address (…workers.dev.evil.net) is blocked');

// Wildcard: one label under the account
await login('');
await req('PATCH', '/api/admin/settings', { allowedOrigins: 'https://*.tester.workers.dev' });
cookie = '';
assert.equal((await login('https://anything.tester.workers.dev')).status, 200);
cookie = '';
assert.equal((await login('https://a.b.tester.workers.dev')).status, 403);
assert.equal((await login('http://anything.tester.workers.dev')).status, 403);
ok('https://*.tester.workers.dev allows your Workers, not deeper names or http');

await login('');
await req('PATCH', '/api/admin/settings', { allowedOrigins: [] });
console.log('origins test passed');
