// Bundles main, preloads, renderers (and optionally tests) with esbuild.
// Usage: node scripts/build.mjs [--tests] [--watch]
import { build, context } from 'esbuild';
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');

const common = { bundle: true, sourcemap: true, logLevel: 'info', absWorkingDir: root };

async function buildTests() {
  const out = path.join(root, 'dist-test');
  await rm(out, { recursive: true, force: true });
  const files = (await readdir(path.join(root, 'test'))).filter((f) => f.endsWith('.test.ts'));
  await build({
    ...common,
    entryPoints: files.map((f) => path.join('test', f)),
    outdir: out,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outExtension: { '.js': '.cjs' },
  });
}

async function buildApp() {
  const out = path.join(root, 'dist');
  await rm(out, { recursive: true, force: true });

  const targets = [
    { entryPoints: { 'main/main': 'src/main/main.ts' }, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' },
    {
      entryPoints: {
        'preload/overlay': 'src/preload/overlay.ts',
        'preload/settings': 'src/preload/settings.ts',
        'preload/workspace': 'src/preload/workspace.ts',
      },
      platform: 'node', format: 'cjs', external: ['electron'], target: 'node22',
    },
    {
      entryPoints: {
        'renderer/overlay/overlay': 'src/renderer/overlay/overlay.ts',
        'renderer/overlay/recorder-worklet': 'src/renderer/overlay/recorder-worklet.ts',
        'renderer/settings/settings': 'src/renderer/settings/settings.ts',
        'renderer/workspace/workspace': 'src/renderer/workspace/workspace.ts',
      },
      platform: 'browser', format: 'iife', target: 'chrome130', minify: true,
    },
  ];

  const contexts = [];
  for (const t of targets) {
    const opts = { ...common, ...t, outdir: out };
    if (watch) {
      const ctx = await context(opts);
      await ctx.watch();
      contexts.push(ctx);
    } else {
      await build(opts);
    }
  }

  // Shared theme + fonts (OFL, bundled locally: no network at runtime)
  const shared = path.join(out, 'renderer', 'shared');
  await mkdir(shared, { recursive: true });
  await cp(path.join(root, 'src', 'renderer', 'theme.css'), path.join(shared, 'theme.css'));
  const fonts = [
    ['@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', 'bricolage.woff2'],
    ['@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', 'instrument-sans.woff2'],
    ['@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-italic.woff2', 'instrument-sans-italic.woff2'],
  ];
  for (const [from, to] of fonts) await cp(path.join(root, 'node_modules', from), path.join(shared, to));

  // Static files: html + css
  for (const page of ['overlay', 'settings', 'workspace']) {
    const dest = path.join(out, 'renderer', page);
    await mkdir(dest, { recursive: true });
    for (const f of await readdir(path.join(root, 'src', 'renderer', page))) {
      if (f.endsWith('.html') || f.endsWith('.css')) {
        await cp(path.join(root, 'src', 'renderer', page, f), path.join(dest, f));
      }
    }
  }
  return contexts;
}

if (args.has('--tests')) {
  await buildTests();
} else {
  await buildApp();
}
