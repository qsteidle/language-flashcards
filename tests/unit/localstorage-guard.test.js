import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const ALLOWED = 'prefs.js'; // the single sanctioned localStorage chokepoint

async function listJs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJs(full)));
    else if (extname(e.name) === '.js') out.push(full);
  }
  return out;
}

describe('localStorage guard (static)', () => {
  it('no src file except prefs.js references localStorage', async () => {
    const files = await listJs(SRC);
    const offenders = [];
    for (const f of files) {
      if (f.endsWith(ALLOWED)) continue;
      const text = await readFile(f, 'utf8');
      // Match actual usage (property access / indexing), not mentions in comments.
      if (/localStorage\s*[.[]/.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe('localStorage guard (runtime size cap)', () => {
  it('rejects writes larger than the few-KB cap', async () => {
    // Fresh in-memory localStorage shim.
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    };
    const { savePrefs } = await import('../../src/prefs.js');

    const huge = 'x'.repeat(10_000); // far over a few KB, like a base64 blob
    expect(() => savePrefs({ theme: huge })).toThrow(/Refusing to write/);

    delete globalThis.localStorage;
  });
});
