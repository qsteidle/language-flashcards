# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
