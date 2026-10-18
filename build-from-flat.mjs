// build-from-flat.mjs — builds the My Life app on Render when the repository's
// files were uploaded without their folders (for example from an iPhone).
// It copies each file into the folder layout the app expects, installs the
// app's packages and builds it into ./dist (Render's "Publish directory").
//
// Render static site settings:
//   Build command:      node build-from-flat.mjs
//   Publish directory:  dist
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const here = process.cwd();
const work = path.join(here, '.app-build');

// [file in the repository, where the app expects it]
const FILES = [
  ['index.html', 'index.html'],
  ['package (1).json', 'package.json'],
  ['apple-touch-icon.png', 'public/icons/apple-touch-icon.png'],
  ['icon-192.png', 'public/icons/icon-192.png'],
  ['icon-512.png', 'public/icons/icon-512.png'],
  ['icon-maskable-512.png', 'public/icons/icon-maskable-512.png'],
  ['manifest.webmanifest', 'public/manifest.webmanifest'],
  ['build.mjs', 'scripts/build.mjs'],
  ['App.tsx', 'src/app/App.tsx'],
  ['SyncBadge.tsx', 'src/app/SyncBadge.tsx'],
  ['actions.ts', 'src/app/actions.ts'],
  ['context.tsx', 'src/app/context.tsx'],
  ['backup.ts', 'src/data/backup.ts'],
  ['persist.ts', 'src/data/persist.ts'],
  ['schema.ts', 'src/data/schema.ts'],
  ['starter.ts', 'src/data/starter.ts'],
  ['store.ts', 'src/data/store.ts'],
  ['sync.ts', 'src/data/sync.ts'],
  ['api.ts', 'src/lib/api.ts'],
  ['dates.ts', 'src/lib/dates.ts'],
  ['env.ts', 'src/lib/env.ts'],
  ['ids.ts', 'src/lib/ids.ts'],
  ['router.tsx', 'src/lib/router.tsx'],
  ['supa.ts', 'src/lib/supa.ts'],
  ['goals.ts', 'src/logic/goals.ts'],
  ['habits.ts', 'src/logic/habits.ts'],
  ['ics.ts', 'src/logic/ics.ts'],
  ['recurrence.ts', 'src/logic/recurrence.ts'],
  ['reminders.ts', 'src/logic/reminders.ts'],
  ['stats.ts', 'src/logic/stats.ts'],
  ['templates.ts', 'src/logic/templates.ts'],
  ['main.tsx', 'src/main.tsx'],
  ['Auth.tsx', 'src/screens/Auth.tsx'],
  ['Goal.tsx', 'src/screens/Goal.tsx'],
  ['Growth.tsx', 'src/screens/Growth.tsx'],
  ['HabitDetail.tsx', 'src/screens/HabitDetail.tsx'],
  ['Journal.tsx', 'src/screens/Journal.tsx'],
  ['Life.tsx', 'src/screens/Life.tsx'],
  ['More.tsx', 'src/screens/More.tsx'],
  ['Onboarding.tsx', 'src/screens/Onboarding.tsx'],
  ['Plan.tsx', 'src/screens/Plan.tsx'],
  ['Reviews.tsx', 'src/screens/Reviews.tsx'],
  ['Settings.tsx', 'src/screens/Settings.tsx'],
  ['Today.tsx', 'src/screens/Today.tsx'],
  ['Week.tsx', 'src/screens/Week.tsx'],
  ['shared.tsx', 'src/screens/shared.tsx'],
  ['styles.css', 'src/styles.css'],
  ['sw.js', 'src/sw.js'],
  ['Chart.tsx', 'src/ui/Chart.tsx'],
  ['icons.tsx', 'src/ui/icons.tsx'],
  ['kit.tsx', 'src/ui/kit.tsx'],
  ['tsconfig.json', 'tsconfig.json'],
];

// iPhone renames files that share a name ("package (1).json", "package (2).json")
// in an unpredictable order, so the app's package.json is found by its contents.
function findFrontendPackage() {
  for (const name of readdirSync(here)) {
    if (!/^package( \(\d+\))?\.json$/.test(name)) continue;
    try {
      if (JSON.parse(readFileSync(path.join(here, name), 'utf8')).name === 'my-life-frontend') return name;
    } catch { /* not JSON */ }
  }
  return null;
}

rmSync(work, { recursive: true, force: true });
const missing = [];
for (let [flat, target] of FILES) {
  if (target === 'package.json') flat = findFrontendPackage() ?? flat;
  const from = path.join(here, flat);
  if (!existsSync(from)) { missing.push(flat); continue; }
  const to = path.join(work, target);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
}
if (missing.length) {
  console.error('These app files are missing from the repository: ' + missing.join(', '));
  process.exit(1);
}
console.log(`[build-from-flat] arranged ${FILES.length} files`);

const run = (cmd) => execSync(cmd, { cwd: work, stdio: 'inherit', env: process.env });
// LOCAL_NODE_MODULES is only for offline testing; Render always installs normally.
if (process.env.LOCAL_NODE_MODULES) execSync(`ln -s ${JSON.stringify(process.env.LOCAL_NODE_MODULES)} node_modules`, { cwd: work });
else run('npm install --no-audit --no-fund');
run('node scripts/build.mjs');

rmSync(path.join(here, 'dist'), { recursive: true, force: true });
cpSync(path.join(work, 'dist'), path.join(here, 'dist'), { recursive: true });
console.log('[build-from-flat] done: dist/ is ready');
