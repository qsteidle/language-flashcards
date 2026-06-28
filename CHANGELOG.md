# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Study sessions are now capped at **20 cards**. Extra due cards stay due and
  appear in the next session; the Study screen shows when the cap is in effect.
- **Load example deck** button in Utilities: imports a bundled Spanish baseball
  vocabulary deck (`decks/default-deck.json`, 49 cards) using the current
  merge/replace choice. Precached by the service worker so it works offline.
- After any import (file or example deck), the app jumps to the Editor so the
  imported cards are immediately visible.

### Changed

- Renamed the app from **Fichas** to **Repasito** (title, manifest, home-screen
  name, icon, and export filename `repasito-backup-*.json`). Service-worker cache
  renamed to `repasito-shell-v1`.
- The Backup tab is now **Utilities**, opened from a settings gear button in the
  top-right of the header instead of occupying a tab slot. Study and Editor are
  now two large, thumb-friendly buttons on the mode row.

### Added

- Optional **Note** field per card (editor textarea, shown on the card back,
  included in search and the JSON export).
- **Reverse study direction:** cards are sometimes shown English-side-first so
  you recall the Spanish term (~30% of cards). Toggle under Backup → Study
  options; on by default.
- Card list is **alphabetized by word, ignoring leading Spanish articles**
  (el/la/los/las/un/una/unos/unas); verbs and adjectives sort by their own
  first letter. Locale-aware (es) comparison.

### Fixed

- Service worker now auto-applies updates: it checks for a newer worker on each
  load and reloads once when one takes control, so a stale cached `app.js` can no
  longer mask new features (e.g. a button whose handler lives in newer JS). Cache
  bumped to `repasito-shell-v2`.
- Service worker is now **network-first**: it always serves fresh code when
  online and only falls back to the cache offline. Previously it was cache-first,
  so after the first visit it kept serving stale `app.js`/`styles.css` and masked
  updates. Cache bumped to `fichas-shell-v2`.
- Tab views no longer overlap: a `.view { display: block }` rule was overriding
  the `hidden` attribute, so all three modes rendered at once. The `hidden`
  attribute now always wins.

### Added (initial build)

- Project scaffold: plain HTML/CSS/ES-modules app, no build step.
- Tooling: ESLint (flat config), Prettier, Vitest, Playwright (WebKit), a
  zero-dependency static dev server, and grep guards for hardcoded audio MIME
  types and native-submit forms.
- Storage layer (`src/storage.js`): IndexedDB wrapper with `deck`/`audio`/`images`
  stores; `saveDeck`/`loadDeck`, media put/get/delete, `exportJSON`/`importJSON`
  with base64-inlined media, `QuotaError` handling, `requestPersist`, `getEstimate`.
- Scheduler (`src/scheduler.js`) and deck operations (`src/deck.js`): session-based
  SM-2 on a 0–3 recall scale, ease floor 1.3, auto-archive at interval ≥ 30.
- `src/prefs.js`: the sole localStorage chokepoint, with a few-KB write cap.
- Unit tests: scheduler correctness, no-tampering invariant, schema round-trip
  (incl. lossless media), session-not-days, due-queue filter, localStorage guard.
- README documenting the model, quick start, iPhone install, backup, scheduling
  rules, tests, and platform limitations.
- App shell (`index.html`) and styling (`styles.css`): three modes (Study /
  Editor / Backup), light + dark themes, reduced-motion aware, large tap
  targets, a cool→warm rating-button color ramp, and a skip link.
- Study mode (`src/app.js`): start session, flip card, four 0–3 rating buttons
  with honest projected next-intervals, progress indicator, and an end-of-session
  summary with export reminder.
- Editor mode: create/edit/archive/unarchive/delete cards; synonym and see-also
  chips; optional image upload with preview; searchable, filterable card browser.
- Audio capture (`src/audio.js`): MIME-feature-detected `MediaRecorder` (never
  hardcodes WebM), record/stop/play, re-record replaces the old blob, mic tracks
  stopped on end.
- Backup mode: export deck (media inlined) to a JSON download, import with
  merge/replace, storage-usage readout, and persistent-storage request.
- PWA: `manifest.json`, generated PNG + SVG icons (`scripts/make-icons.js`),
  `service-worker.js` precaching the app shell for offline, and an iOS
  add-to-home-screen hint.
- End-to-end tests (Playwright/WebKit): IndexedDB persistence across reload,
  audio blob round-trip, `QuotaExceededError` messaging, audio MIME
  feature-detection, service-worker shell precache for offline, and axe-core
  accessibility checks on all three screens.
- Optional `.githooks/pre-commit`: requires a CHANGELOG update and runs the fast
  checks.

### Changed

- Media (audio/images) is persisted as a native `ArrayBuffer` + MIME type rather
  than as a Blob. Still binary (no base64 inflation), still surfaced to callers
  as Blobs, and it avoids a Blob-in-IndexedDB serialization bug in some WebKit
  builds. The base64-inlined JSON export is unchanged.
