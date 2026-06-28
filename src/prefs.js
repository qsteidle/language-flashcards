// The ONLY module permitted to touch localStorage. Cards and media never go
// here — they live in IndexedDB (see storage.js). localStorage holds only tiny
// UI preferences. A hard size cap makes accidental misuse fail loudly.
//
// tests/unit/localstorage-guard.test.js enforces both rules: that no other src
// file references localStorage, and that this module rejects large writes.

const KEY = 'lf:prefs';
const MAX_BYTES = 4096; // a few KB ceiling; cards/audio must never come near this

const DEFAULTS = Object.freeze({
  theme: 'auto', // 'auto' | 'light' | 'dark'
  stripAudioOnAutoArchive: null, // null = not yet asked; true/false once chosen
  showProjectedIntervals: true,
  lastExportAt: null, // ISO string of last export, for the "export reminder"
});

function hasStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function getPrefs() {
  if (!hasStorage()) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(partial) {
  const merged = { ...getPrefs(), ...partial };
  const serialized = JSON.stringify(merged);
  const size = new Blob([serialized]).size;
  if (size > MAX_BYTES) {
    throw new Error(
      `Refusing to write ${size} bytes to localStorage (cap ${MAX_BYTES}). ` +
        'localStorage is for tiny prefs only; large data belongs in IndexedDB.'
    );
  }
  if (hasStorage()) localStorage.setItem(KEY, serialized);
  return merged;
}

export function getPref(name) {
  return getPrefs()[name];
}

export function setPref(name, value) {
  return savePrefs({ [name]: value });
}

export { KEY as PREFS_KEY, MAX_BYTES as PREFS_MAX_BYTES, DEFAULTS as PREF_DEFAULTS };
