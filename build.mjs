import * as esbuild from 'esbuild';
import path from 'node:path';
const root = path.resolve('.');
const meteorShim = {
  name: 'meteor-shim',
  setup(b) {
    b.onResolve({ filter: /^meteor\/aldeed:simple-schema$/ }, () => ({ path: path.join(root, 'node_modules/simpl-schema/dist/main.js') }));
    b.onResolve({ filter: /^meteor\// }, () => ({ path: path.join(root, 'shim/meteor.js') }));
    // The action engine reads creatures through loadCreatures; ours serves them from memory
    b.onResolve({ filter: /^\/imports\/api\/engine\/loadCreatures$/ }, () => ({ path: path.join(root, 'src/engine/loadCreatures.ts') }));
    b.onResolve({ filter: /^\/imports\/(server|client)\// }, () => ({ path: path.join(root, 'shim/noop.js') }));
    b.onResolve({ filter: /^\/imports\// }, a => ({ path: require_resolve(path.join(root, 'vendor', a.path)) }));
    b.onResolve({ filter: /^(ddp-rate-limiter-mixin|@aws-sdk\/client-s3|chai)$/ }, () => ({ path: path.join(root, 'shim/empty.js') }));
  },
};
import fs from 'node:fs';
function require_resolve(p) {
  p = path.normalize(p).replace(/[\/]+$/, '');
  for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) if (fs.existsSync(p + ext) && fs.statSync(p + ext).isFile()) return p + ext;
  return p;
}
// Version info compiled into the server (shown on the Admin page)
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const upstream = JSON.parse(fs.readFileSync('vendor/UPSTREAM.json', 'utf8'));
await esbuild.build({
  entryPoints: process.argv.slice(2),
  define: {
    __DICESHEET_VERSION__: JSON.stringify(pkg.version),
    __DICECLOUD_UPSTREAM__: JSON.stringify(`${upstream.branch}@${upstream.commit.slice(0, 7)}`),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: 'dist', target: 'node22',
  plugins: [meteorShim], inject: ['shim/meteor-globals.js'], logLevel: 'warning', logLimit: 0,
  external: ['mongodb', 'sharp', 'bcrypt'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
