// Guard: audio MIME types must only appear inside the feature-detection
// preference array in src/audio.js. Fail if 'audio/webm' or 'audio/mp4'
// string literals appear anywhere else.
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Only shipped app code is checked. audio.js owns the feature-detection list;
// tests legitimately assert on concrete MIME strings.
const ALLOWED_FILE = 'src/audio.js';
const PATTERN = /audio\/(webm|mp4)/;

const SKIP_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', '.git']);

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else if (['.js', '.html'].includes(extname(entry.name))) acc.push(full);
  }
  return acc;
}

// Shipped app code only: src/ (minus audio.js) and index.html.
const files = [...(await walk(join(ROOT, 'src'))), join(ROOT, 'index.html')];
const violations = [];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel === ALLOWED_FILE) continue;
  const text = await readFile(file, 'utf8').catch(() => '');
  text.split('\n').forEach((line, i) => {
    if (PATTERN.test(line)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

if (violations.length) {
  console.error('Hardcoded audio MIME type found outside feature-detection list:');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('OK: no hardcoded audio MIME types outside the feature-detection list.');
