// Visual fixture harness: renders the shipped scene demos in the deterministic overlay (?still=1),
// then compares 64x64 thumbnails against the last accepted baseline.
//
//   npm run visual            # render + compare against baseline.json (exit 1 on regression)
//   npm run visual -- --update  # accept the current render as the new baseline
//
// The comparison is deliberately coarse (mean absolute channel difference on a 64x64 thumbnail).
// GPU antialiasing differs across drivers, so exact pixel equality is not a useful gate here.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.visual');
const update = process.argv.includes('--update');
const threshold = Number(process.env.VISUAL_THRESHOLD ?? 2.5);

mkdirSync(out, { recursive: true });

const exitCode = await new Promise((resolve) => {
  const child = spawn(electron, ['.'], {
    env: { ...process.env, HEYGUY_FIXTURES: out },
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(`[visual] could not start Electron: ${err.message}`);
    resolve(1);
  });
  child.on('exit', (code) => resolve(code ?? 1));
});
if (exitCode !== 0) process.exit(exitCode);

const reportPath = path.join(out, 'report.json');
if (!existsSync(reportPath)) {
  console.error(`[visual] no report at ${reportPath}`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const captures = report.captures ?? [];
if (captures.length === 0) {
  console.error('[visual] report contains no captures');
  process.exit(1);
}

const baselinePath = path.join(out, 'baseline.json');
if (update || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify({ captures: captures.map(({ name, thumb }) => ({ name, thumb })) }, null, 2));
  console.log(`[visual] baseline written for ${captures.length} scenes → ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const byName = new Map((baseline.captures ?? []).map((c) => [c.name, c.thumb]));
let failed = 0;

for (const capture of captures) {
  const before = byName.get(capture.name);
  if (!before) {
    console.log(`NEW   ${capture.name}`);
    continue;
  }
  const a = Buffer.from(before, 'base64');
  const b = Buffer.from(capture.thumb, 'base64');
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    console.log(`EMPTY ${capture.name}`);
    failed++;
    continue;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  const mad = sum / n;
  const ok = mad <= threshold;
  if (!ok) failed++;
  const stats = capture.stats ? ` · ${capture.stats.triangles} tris, ${capture.stats.drawCalls} calls, ${capture.stats.fps} fps` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${capture.name.padEnd(14)} diff ${mad.toFixed(2)} (limit ${threshold})${stats}`);
}

if (failed > 0) {
  console.error(`[visual] ${failed} scene(s) changed. Review ${out}/*.png, then re-run with --update to accept.`);
  process.exit(1);
}
console.log(`[visual] ${captures.length} scenes match baseline (limit ${threshold}).`);
