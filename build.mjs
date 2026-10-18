// Builds the static site into dist/.
//   npm run build          production build (minified, hashed file names)
//   npm run dev            build + watch + local server on http://localhost:5173
//
// Public configuration comes from environment variables at build time
// (see ../.env.example). Only public values belong here: the Supabase URL,
// the Supabase publishable (anon) key and the backend URL. Never the secret key.
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

loadDotEnv(path.join(root, '.env'));
loadDotEnv(path.join(root, '..', '.env'));

const config = {
  supabaseUrl: (process.env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: process.env.PUBLIC_SUPABASE_KEY || '',
  apiUrl: (process.env.PUBLIC_API_URL || '').replace(/\/+$/, ''),
};

if (/sb_secret_|service_role/i.test(config.supabaseKey) || looksLikeServiceRoleJwt(config.supabaseKey)) {
  console.error('\nPUBLIC_SUPABASE_KEY looks like a SECRET / service_role key. Use the publishable (anon) key instead.\n');
  process.exit(1);
}
if (!config.supabaseUrl || !config.supabaseKey) {
  console.warn('\n[build] PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_KEY is not set. The app will show a setup message until they are.\n');
}

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
function looksLikeServiceRoleJwt(key) {
  if (!key.startsWith('eyJ')) return false;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return payload.role === 'service_role';
  } catch { return false; }
}

const buildOptions = {
  entryPoints: { app: path.join(root, 'src/main.tsx') },
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: path.join(dist, 'assets'),
  entryNames: serve ? '[name]' : '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  assetNames: '[name]-[hash]',
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  target: ['safari15', 'chrome100', 'firefox100'],
  jsx: 'automatic',
  metafile: true,
  define: {
    __APP_CONFIG__: JSON.stringify(config),
    __BUILD_ID__: JSON.stringify(new Date().toISOString()),
    'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production'),
  },
  logLevel: 'info',
};

function writeHtmlAndServiceWorker(result) {
  const outputs = Object.keys(result.metafile.outputs).map((f) => path.relative(dist, path.resolve(process.cwd(), f)).split(path.sep).join('/'));
  const entryJs = outputs.find((f) => /assets\/app(-[A-Z0-9]+)?\.js$/i.test(f));
  const entryCss = outputs.find((f) => /assets\/app(-[A-Z0-9]+)?\.css$/i.test(f));
  if (!entryJs) throw new Error('Entry bundle not found');

  // Copy public/ (manifest, icons) into dist/.
  cpSync(path.join(root, 'public'), dist, { recursive: true });

  let html = readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace('<!--CSS-->', entryCss ? `<link rel="stylesheet" href="/${entryCss}">` : '');
  html = html.replace('<!--JS-->', `<script type="module" src="/${entryJs}"></script>`);
  writeFileSync(path.join(dist, 'index.html'), html);

  // Precache list for the service worker: the app shell, every bundle and icon.
  const files = listFiles(dist).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
  const hash = createHash('sha256');
  for (const f of files.sort()) hash.update(f).update(readFileSync(path.join(dist, f)));
  const version = hash.digest('hex').slice(0, 12);
  const sw = readFileSync(path.join(root, 'src/sw.js'), 'utf8')
    .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(['/', ...files.filter((f) => f !== 'index.html').map((f) => '/' + f)])};`)
    .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`);
  if (sw.includes('__PRECACHE__;') || sw.includes("'__VERSION__'")) throw new Error('Service worker placeholders were not replaced');
  writeFileSync(path.join(dist, 'sw.js'), sw);
  console.log(`[build] ${files.length} files, cache version ${version}`);
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

if (!serve) {
  const result = await esbuild.build(buildOptions);
  writeHtmlAndServiceWorker(result);
} else {
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [{
      name: 'html',
      setup(build) { build.onEnd((r) => { if (!r.errors.length) writeHtmlAndServiceWorker(r); }); },
    }],
  });
  await ctx.watch();
  const port = Number(process.env.PORT || 5173);
  const { createServer } = await import('node:http');
  createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`[dev] http://localhost:${port}`));
}
