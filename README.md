# Spanish Flashcards — session-based spaced repetition

An offline-first, single-page web app for studying Spanish vocabulary. It runs
entirely in the browser, installs to your phone's home screen as a PWA, and works
with no network, no backend, and no App Store. All data lives on your device in
IndexedDB; the JSON export is your real backup.

The defining idea is **session-based spaced repetition**: cards become due after
N _study sessions_, not N calendar days. A "session" is one continuous study run.
This lets you study several times a day at your own pace — the scheduler advances
when you study, not when the clock ticks.

## Three modes

- **Study** — flip a card, rate your recall (No / Hard / Medium / Easy), and the
  scheduler decides when the card returns.
- **Editor** — create, edit, browse, archive, and delete cards. Attach an optional
  image and an optional voice recording per card.
- **Utilities** (gear button, top-right) — export the whole deck (with media
  inlined) to a JSON file, import it back, **load a bundled example deck**
  (Spanish baseball vocabulary), toggle study options, and see storage usage.

## Quick start (local)

```bash
npm install
npm run serve      # serves the app at http://localhost:4173
```

Open <http://localhost:4173> in a browser. No build step — it's plain HTML/CSS and
ES modules.

## Loading it on an iPhone

1. Serve the folder over **HTTPS or localhost** (PWAs require a secure context).
   For phone testing on your LAN, put it behind any static HTTPS host, or use a
   tunnel. The included `npm run serve` is HTTP/localhost only — fine for the
   laptop, not for a remote phone.
2. Open the URL in **Safari**.
3. Tap **Share → Add to Home Screen**.
4. Launch it from the home-screen icon.

**Why the home-screen install matters:** iOS evicts script-writable storage
(IndexedDB included) after ~7 days of non-use _unless the app is installed to the
home screen_. Installing it makes your deck durable. Even so, export regularly.

## Data & backup

- Your deck (cards + audio + images) is stored in **IndexedDB** on the device.
  `localStorage` is used only for tiny UI preferences, never for cards or media.
- Media is stored as native binary (an `ArrayBuffer` plus its MIME type), not as
  base64, so there is no ~33% size inflation. The app works in Blobs everywhere
  else; this is just the on-disk representation, which also avoids a Blob-in-
  IndexedDB serialization bug in some WebKit builds. The JSON **export** still
  uses base64 so the backup file is self-contained and text-portable.
- iOS can evict storage after ~7 days of non-use if the app is _not_ installed to
  the home screen (see above).
- **The JSON export is the true backup.** Use Backup → Export periodically and
  keep the file somewhere safe (AirDrop to a Mac, email it to yourself, etc.).
  The app reminds you when it has been a while.
- The app requests persistent storage (`navigator.storage.persist()`) on first
  run and shows how much space the deck is using.

## The scheduling rules

Recall is rated on a **0–3 scale**: `0 = No` (blank), `1 = Hard`, `2 = Medium`,
`3 = Easy`. The algorithm is **SM-2 adapted to sessions and the 0–3 scale**:

```
if rating == 0 (No):
    reps = 0
    interval = 1                       # due next session
    ease = max(1.3, ease - 0.20)
else:
    reps += 1
    if reps == 1:   interval = 1
    elif reps == 2: interval = 3
    else:           interval = round(interval * ease)   # uses pre-adjustment ease
    if rating == 1 (Hard):   ease = max(1.3, ease - 0.15)
    if rating == 2 (Medium): ease unchanged
    if rating == 3 (Easy):   ease = ease + 0.15

dueAtSession = sessionCounter + interval
```

- A card is **due** when `sessionCounter >= dueAtSession`.
- Ease floor is **1.3** (no ceiling; it grows slowly by design).
- **Auto-archive:** when an interval reaches **30 sessions**, the card is archived
  out of the rotation (it stays in the data file). You're asked once whether to
  strip its audio to reclaim space, and the answer is remembered.
- **Honesty guarantee:** every interval is the deterministic output of these rules
  applied to your real ratings. There is no "boost" or "auto-pass" anywhere, and
  a unit test (`no-tampering`) enforces it.

## Running the tests and checks

| Command                | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run test:unit`    | Vitest — scheduler math, no-tampering, schema round-trip, etc.    |
| `npm run test:e2e`     | Playwright (WebKit / iOS Safari approximation) — E2E, PWA, a11y.  |
| `npm test`             | Both of the above.                                                |
| `npm run lint`         | ESLint.                                                           |
| `npm run format:check` | Prettier check (use `npm run format` to fix).                     |
| `npm run check:mime`   | Fails if an audio MIME type is hardcoded outside the detect list. |
| `npm run check:forms`  | Fails if a native-submit `<form>` exists in `index.html`.         |
| `npm run check:all`    | Lint + format check + guards + unit tests (fast pre-commit set).  |

The first `npm run test:e2e` needs the Playwright WebKit browser — install it
once with `npx playwright install webkit`.

### Optional pre-commit hook

```bash
git config core.hooksPath .githooks
```

This fails any commit that does not touch `CHANGELOG.md` and then runs the fast
checks (lint, format, grep guards, unit tests). Run `npm run test:e2e` before
pushing.

### E2E coverage (Playwright, WebKit ≈ iOS Safari)

- IndexedDB persistence across reload; audio blob round-trip (size + type).
- `QuotaExceededError` surfaces a clear export/free-space message, no crash.
- Audio MIME feature-detection picks by preference and never hardcodes WebM.
- Service worker registers, controls the page, and precaches the full app shell
  for offline use.
- axe-core finds no critical/serious WCAG 2 A/AA violations on any screen.

### Unit test coverage (replaces manual iPhone testing for the core)

1. **Scheduler correctness** — exact interval/ease/reps/dueAtSession for a streak,
   a lapse, the ease floor, and the auto-archive flag.
2. **No-tampering** — deck state after known ratings equals an independently
   hand-computed expectation.
3. **Schema round-trip** — `importJSON(exportJSON(deck))` is deep-equal, media
   included, losslessly.
4. **Session-not-days** — bumping the session counter (not the clock) makes cards
   due.
5. **Due-queue filter** — archived cards never enter; only due, non-archived do.
6. **localStorage guard** — only `src/prefs.js` may touch localStorage, and writes
   over a few KB are refused.

## Known platform limitations

- **Storage caps:** `localStorage` is ~5 MB per origin (we keep it tiny on
  purpose). IndexedDB is the real store and allows far more on iOS, scaling with
  free disk.
- **Audio format:** iOS Safari `MediaRecorder` outputs `audio/mp4` (AAC), not
  WebM. The app feature-detects the type with `MediaRecorder.isTypeSupported()`
  and never hardcodes a MIME type.
- **No push / background:** without a home-screen install there's no guaranteed
  persistence, and there are no push notifications.

## Project layout

```
index.html            app shell (no native-submit forms)
styles.css            styling, light/dark, reduced-motion aware
src/scheduler.js      pure SM-2 session math (no DOM, no storage)
src/deck.js           deck-level operations (create/start/review)
src/storage.js        IndexedDB wrapper + export/import + quota handling
src/serialize.js      base64 <-> Blob (export only)
src/prefs.js          the ONLY localStorage chokepoint
src/audio.js          MIME-detecting recorder + playback
src/app.js            UI controller wiring it all together
decks/default-deck.json  bundled example deck (Spanish baseball vocabulary)
manifest.json         PWA manifest
service-worker.js     app-shell cache for offline
icons/                PWA icons
scripts/              dev server + pre-commit grep guards
tests/unit/           Vitest
tests/e2e/            Playwright (WebKit)
```
