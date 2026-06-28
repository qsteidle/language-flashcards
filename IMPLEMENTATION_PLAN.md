# Implementation Plan — Spanish Flashcard App (for GitHub Copilot)

> **How to use this file:** Open this repo in VS Code with GitHub Copilot. Work through the phases in order. After each phase, run the automated checks in the "Tests & checks" section before moving on. Update `README.md` and `CHANGELOG.md` on every commit (see "Repo hygiene" at the end). Do not skip the checks — they are how we catch regressions without manual iPhone testing.

---

## 1. What we are building

A single-page web app for studying Spanish vocabulary using **session-based spaced repetition**. It runs in the browser, installs to the iPhone home screen as a PWA, and works fully offline. No backend, no App Store, no Swift, no developer account.

The app has three modes:
1. **Study** — flip a card, rate recall, the scheduler decides when the card returns.
2. **Editor** — create, edit, browse, archive, and delete cards.
3. **Backup** — export and import the whole deck as a JSON file.

### Non-negotiable design decisions (already settled — do not change without asking)
- **Scheduling is measured in *sessions*, not days.** A "session" is one continuous study run. Cards become due after N sessions, not N calendar days. This lets the user study multiple times a day at their own pace.
- **Recall rating is a 0–3 scale:** `0 = No` (blank), `1 = Hard`, `2 = Medium`, `3 = Easy`. Do not use the classic SM-2 0–5 scale.
- **The scheduling algorithm is SM-2, adapted** to the session model and the 0–3 scale (details in Phase 3).
- **Cards can be archived** (manually anytime, or auto-archived once their interval crosses a threshold). Archived cards leave the study rotation but stay in the data file.
- **Audio is supported** via in-browser microphone recording (voice-memo style), attached per card.
- **Images are optional** per card.
- **Never fabricate or artificially alter study results.** The scheduler must compute intervals honestly from real ratings. Do not add any "boost", "auto-pass", "demo data injection", or shortcut that changes a card's computed state to something other than what the algorithm produces from genuine user input. Test fixtures must be clearly labeled as fixtures and never written into the user's real deck.

---

## 2. Verified platform constraints (current as of mid-2026 — build around these)

These are the real-world limits that drive the storage and audio decisions. They are confirmed, not assumptions.

### Storage
- **`localStorage` is capped at ~5 MB per origin.** Too small once audio is involved. Use it only for tiny things like the current session counter and UI preferences.
- **Use IndexedDB as the primary store** for the deck (cards + audio blobs). On iOS it allows far more (commonly hundreds of MB, scaling with free disk space). Store audio as **Blobs**, not base64 strings — IndexedDB stores binary natively, and base64 inflates size ~33%.
- **iOS evicts script-writable storage after ~7 days of non-use** *unless the app is added to the home screen.* Therefore: (a) treat "Add to Home Screen" as a real requirement and guide the user to do it, and (b) **the JSON export is the true backup** — storage on device is not guaranteed permanent. Prompt the user to export periodically.
- Use `navigator.storage.persist()` to request persistent storage, and `navigator.storage.estimate()` to show the user how much space the deck is using.

### Audio
- iOS Safari supports `MediaRecorder`, but **outputs `audio/mp4` (AAC), not WebM.** Do **not** hardcode a MIME type. Feature-detect with `MediaRecorder.isTypeSupported()` and pick the first supported type from a preference list (`audio/mp4`, `audio/webm;codecs=opus`, `audio/webm`).
- `AudioContext` / recording must be **started inside a user gesture** (a tap handler). Creating it on page load leaves it suspended on iOS.
- Always call `stream.getTracks().forEach(t => t.stop())` when recording ends, or the mic indicator stays on.
- Store the recorded Blob's actual `.type` alongside it so playback uses the correct format.

### PWA / offline
- Provide a `manifest.json` (name, icons, `display: standalone`, theme colors) and a service worker that caches the app shell so it loads offline.
- iOS does not auto-prompt to install. Detect iOS + not-installed and show brief "tap Share → Add to Home Screen" instructions.

---

## 3. Data model

Keep the whole deck in one logical structure, persisted to IndexedDB and exportable as one JSON file.

```jsonc
{
  "schemaVersion": 1,
  "meta": {
    "sessionCounter": 0,        // increments each time a study session starts
    "createdAt": "ISO-8601",
    "lastExportedAt": "ISO-8601 | null"
  },
  "cards": [
    {
      "id": "uuid",
      "word": "el perro",         // Spanish term (front)
      "definition": "the dog",    // meaning (back)
      "pos": "noun",              // part of speech
      "example": "El perro corre en el parque.",
      "synonyms": ["el can"],     // array of strings
      "seeAlso": ["la mascota"],  // array of related-term strings
      "imageId": "uuid | null",   // FK into the images object store, or null
      "audioId": "uuid | null",   // FK into the audio object store, or null
      "archived": false,
      "stats": {
        "interval": 1,            // sessions until next due
        "ease": 2.5,             // ease factor (multiplier)
        "reps": 0,               // successful reps in a row
        "dueAtSession": 1,        // becomes due when sessionCounter >= this
        "lastRating": null,       // 0-3 of most recent review
        "reviewCount": 0
      }
    }
  ]
}
```

- **Audio and image blobs live in separate IndexedDB object stores** (`audio`, `images`), keyed by their own uuid, referenced from the card by `audioId` / `imageId`. This keeps the card records light and makes "strip audio on archive" easy.
- The **JSON export** must inline the media so the file is self-contained: serialize blobs to base64 *only at export time*, and decode back to blobs on import. (Base64 is acceptable for the portable export file even though it's not used for live storage.)

### Scheduling algorithm (SM-2, session-adapted, 0–3 scale)

On each review, given `rating ∈ {0,1,2,3}`:

```
if rating == 0:            // No — failed
    reps = 0
    interval = 1           // due next session
    ease = max(1.3, ease - 0.20)
else:
    reps = reps + 1
    if reps == 1:        interval = 1
    elif reps == 2:      interval = 3
    else:                interval = round(interval * ease)

    // ease adjustment by rating
    if rating == 1:  ease = max(1.3, ease - 0.15)   // Hard
    if rating == 2:  ease = ease                     // Medium — no change
    if rating == 3:  ease = ease + 0.15              // Easy

dueAtSession = meta.sessionCounter + interval
lastRating = rating
reviewCount += 1
```

- A card is **due** when `meta.sessionCounter >= stats.dueAtSession`.
- **Auto-archive threshold:** if `interval >= 30` (sessions) after an update, flag the card for auto-archive (move to archived, optionally strip its audio blob to reclaim space — ask the user once whether they want audio stripped on auto-archive, then remember the preference).
- `ease` floor is `1.3`. There is no ceiling, but it grows slowly by design.
- **Do not deviate from this math.** Every interval must be the honest output of these rules applied to real ratings.

---

## 4. Build phases

### Phase 0 — Project scaffold
- Plain HTML/CSS/JS, no build step required (keeps it copy-to-iPhone simple). If you introduce a bundler, document why in the README and keep the output a single deployable folder.
- Files: `index.html`, `app.js` (or small ES modules), `styles.css`, `manifest.json`, `service-worker.js`, `/icons/`.
- No external runtime dependencies unless justified. If you need a tiny IndexedDB helper, prefer `idb` (small, well-maintained) loaded from a CDN that the service worker also caches — but vanilla IndexedDB is acceptable and avoids a dependency.

### Phase 1 — Storage layer
- Implement an IndexedDB wrapper with object stores: `deck` (single record holding cards + meta), `audio`, `images`.
- Implement `saveDeck()`, `loadDeck()`, `putAudio()`, `getAudio()`, `putImage()`, `getImage()`, `deleteAudio()`, `deleteImage()`.
- Implement `exportJSON()` (inline media as base64) and `importJSON()` (validate schema, decode media, merge or replace — ask user which).
- Call `navigator.storage.persist()` on first run; surface `navigator.storage.estimate()` in a small "storage used" readout.
- Handle `QuotaExceededError` gracefully with a clear message pointing the user to export + free space.

### Phase 2 — Editor mode
- Form with fields matching the data model: word, definition, POS (dropdown of common parts of speech), example, synonyms (add/remove chips), seeAlso (add/remove chips), image upload (optional), audio record/playback (optional).
- Card browser: list/search existing cards, edit, archive/unarchive, delete (with confirm). Show archived cards in a separate filtered view.
- **No HTML `<form>` submit navigation** — handle everything with JS event handlers so it behaves like an app.

### Phase 3 — Scheduler
- Implement the algorithm exactly as specified in section 3.
- `startSession()` increments `meta.sessionCounter` and builds the due queue (`cards` where not archived and `dueAtSession <= sessionCounter`), shuffled.
- `reviewCard(cardId, rating)` applies the algorithm, persists, and handles the auto-archive threshold.

### Phase 4 — Study mode
- Show the front (word). Tap to flip and reveal definition, POS, example, synonyms, seeAlso, image, and an audio play button.
- Four rating buttons: No / Hard / Medium / Easy (0–3). Optionally show the resulting next-interval under each button so the user sees the consequence.
- Progress indicator (cards remaining this session).
- When the queue empties, show a session summary (counts per rating — honest tallies only) and a reminder to export if it's been a while.

### Phase 5 — Audio capture
- Mic button uses `getUserMedia({audio:true})` inside the tap handler, feature-detects MIME type, records, stores the Blob in the `audio` store, links `audioId` to the card.
- Playback via `URL.createObjectURL(blob)` on an `<audio>` element; revoke the object URL after use.
- Re-record replaces the old blob (delete the orphan).

### Phase 6 — PWA / offline
- `manifest.json` + icons + service worker caching the app shell.
- iOS install hint when not in standalone mode.
- Verify the app loads with the network disabled after first visit.

### Phase 7 — Styling (lowest priority; functional first)
Aesthetics come after everything works, but a few choices genuinely help language learning, so bake in the structure now and refine later:
- **Typography:** a clear, high-legibility sans for UI; ensure accented characters (á é í ó ú ñ ü ¿ ¡) render cleanly at all sizes. Make the Spanish term visually dominant on the card front.
- **Color:** calm, low-distraction background; reserve a small distinct palette for the four rating buttons so they're muscle-memory consistent (e.g. a cool-to-warm or muted ramp from No→Easy). Ensure WCAG AA contrast in both light and dark mode.
- **Card focus:** the study card should feel like the center of attention — generous whitespace, minimal chrome, large tap targets (good for thumbs on a phone).
- Respect `prefers-color-scheme` and `prefers-reduced-motion`.

---

## 5. Tests & checks (automate these — they replace manual iPhone testing)

Set up a minimal test runner the agent can execute headlessly. **Vitest + jsdom** for unit logic, **Playwright** (WebKit project) for end-to-end and PWA/offline behavior — Playwright's WebKit engine approximates iOS Safari far better than Chromium for this app. Add an `npm test` script that runs both.

### Unit tests (Vitest) — pure logic, no DOM
1. **Scheduler correctness.** For a fixed sequence of ratings, assert the exact `interval`, `ease`, `reps`, and `dueAtSession` values at each step. Cover: a perfect-recall streak, a lapse (rating 0) resetting interval to 1, the ease floor not dropping below 1.3, and the auto-archive flag firing at `interval >= 30`.
2. **No-tampering invariant.** Assert there is no code path that sets card stats to values not produced by the algorithm. (Concretely: a test that runs a session of known ratings and verifies the deck state equals an independently computed expected state — any "boost" would break it.)
3. **Schema round-trip.** `importJSON(exportJSON(deck))` returns a deck deep-equal to the original, including media (encode/decode base64 losslessly).
4. **Session-not-days.** Advancing the session counter (not the wall clock) is what makes cards due. A test that bumps `sessionCounter` makes due cards appear; advancing time alone does not.
5. **Due-queue filter.** Archived cards never enter the queue; only `dueAtSession <= sessionCounter` non-archived cards do.

### Integration / E2E tests (Playwright, WebKit)
6. **IndexedDB persistence.** Create cards, reload the page, assert they survive. Store and retrieve an audio blob; assert the retrieved blob's size and type match.
7. **Quota handling.** Mock a `QuotaExceededError` on save and assert the app shows the export/free-space message instead of crashing.
8. **Offline load.** Load once, go offline (Playwright `context.setOffline(true)`), reload, assert the app shell still renders.
9. **Audio MIME feature-detection.** Assert the recorder selects a supported type from the preference list and never hardcodes WebM. (Can be unit-tested by stubbing `MediaRecorder.isTypeSupported`.)
10. **No `localStorage` for large data.** A static check / test asserting audio and card bodies are written to IndexedDB, and `localStorage` only ever holds the small keys (session counter, prefs). Fail if a write to `localStorage` exceeds a few KB.

### Pre-commit automated checks (wire into a script, optionally a git hook)
- `npm test` passes (unit + E2E).
- **Lint** (ESLint) and **format** (Prettier) clean.
- **No hardcoded audio MIME type** grep check (fails if `'audio/webm'` appears outside the feature-detection preference array).
- **No `<form>` with default submit** in study/editor markup (grep guard).
- **Schema version present** on every exported file.
- **Accessibility smoke test:** Playwright + axe-core on the study and editor screens, assert no critical violations (contrast, labels, tap-target size).
- **CHANGELOG updated** check: fail the pre-commit if `CHANGELOG.md` was not modified in the staged changes (see below).

Document in the README exactly how to run each check so they can be re-run by hand.

---

## 6. Repo hygiene — README and CHANGELOG (update on EVERY commit)

### README.md — keep current as features land
Must contain, at minimum:
- One-paragraph description of the app and its session-based spaced-repetition model.
- **Quick start:** how to run locally, how to load it on an iPhone (serve over HTTPS or localhost, open in Safari, Share → Add to Home Screen) and *why* home-screen install matters (storage eviction).
- **Data & backup:** where data lives (IndexedDB), the 7-day eviction caveat, and the instruction to export JSON regularly as the real backup.
- **The scheduling rules** (the 0–3 scale and the session-based SM-2 math) so future-you understands why intervals behave as they do.
- **How to run the tests and pre-commit checks**, listed individually.
- Known platform limitations (iOS storage caps, audio format, no push without home-screen install).

### CHANGELOG.md — append an entry on every commit
- Follow **Keep a Changelog** format with **Semantic Versioning** headers.
- Group entries under `Added`, `Changed`, `Fixed`, `Removed`.
- Keep an `## [Unreleased]` section at top; move it under a version number on release.
- The pre-commit check (section 5) should fail any commit that doesn't touch `CHANGELOG.md`, so the log never drifts from reality.
- Seed it now with an initial `## [Unreleased]` → `Added: project scaffold` entry.

### Commit discipline
- Small, focused commits per phase/feature.
- Commit message references the phase (e.g. `feat(scheduler): session-based SM-2 with 0-3 scale`).
- Never commit a deck containing real personal study data or test fixtures into the repo; keep sample/fixture decks clearly named (`fixtures/sample-deck.json`) and obviously synthetic.

---

## 7. Order of operations for the agent (TL;DR)

1. Scaffold (Phase 0) → commit, seed README + CHANGELOG.
2. Storage layer (Phase 1) + its unit tests (#3, #10) → commit.
3. Scheduler (Phase 3) + its unit tests (#1, #2, #4, #5) → commit. *(Build the engine before the UI so the tested core is solid.)*
4. Editor (Phase 2) → commit.
5. Study mode (Phase 4) → commit.
6. Audio (Phase 5) + tests (#6 audio, #9) → commit.
7. PWA/offline (Phase 6) + tests (#8) → commit.
8. Quota + a11y + remaining E2E (#7, axe) → commit.
9. Styling pass (Phase 7) → commit.
10. Final: full `npm test` green, all pre-commit checks green, README + CHANGELOG current.

Build the scheduler and storage with tests *before* the UI. The visible app is the easy part to fix; the scheduling math and the data integrity are where silent bugs hide, and they're exactly what the user asked to keep honest.
