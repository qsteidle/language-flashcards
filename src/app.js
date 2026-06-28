// UI controller. Wires the tested core (scheduler/deck/storage) to the DOM.
// Everything is handled with JS event handlers — there are no native-submit
// forms, so the app never navigates away.

import {
  createCard,
  findCard,
  startSession,
  reviewCard,
  setArchived,
  deleteCard,
  emptyTally,
  sortCardsByWord,
  COMMON_POS,
} from './deck.js';
import { RATING_LABELS, projectInterval } from './scheduler.js';
import {
  loadOrCreateDeck,
  saveDeck,
  putAudio,
  getAudio,
  deleteAudio,
  putImage,
  getImage,
  deleteImage,
  exportJSON,
  importJSON,
  requestPersist,
  getEstimate,
  QuotaError,
} from './storage.js';
import { getPrefs, setPref } from './prefs.js';
import { startRecording, audioRecordingSupported } from './audio.js';

const $ = (id) => document.getElementById(id);
const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
// Fraction of cards shown English-side-first when the reverse option is on.
const REVERSE_PROBABILITY = 0.3;

let deck = null;

const study = {
  queue: [], // remaining card ids this session
  current: null, // current card id
  flipped: false,
  reversed: false, // current card shown English-side-first
  tally: emptyTally(),
  audioUrl: null,
};

const editor = {
  editingId: null,
  synonyms: [],
  seeAlso: [],
  // pending media changes, applied on save
  newImageBlob: null,
  imageId: null,
  removeImage: false,
  newAudioBlob: null,
  audioId: null,
  recorder: null,
  previewUrl: null,
};

let cardFilter = 'active';

// ---------------------------------------------------------------- utilities

function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function sessionsLabel(n) {
  return n === 1 ? '1 session' : `${n} sessions`;
}

async function persistDeck() {
  try {
    await saveDeck(deck);
  } catch (err) {
    if (err instanceof QuotaError) {
      toast('Storage is full. Export your deck and free up space.', 6000);
    } else {
      toast('Could not save. ' + (err.message || err));
    }
    throw err;
  }
}

async function playBlob(blob, urlSlot) {
  if (study[urlSlot]) URL.revokeObjectURL(study[urlSlot]);
  const url = URL.createObjectURL(blob);
  study[urlSlot] = url;
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (study[urlSlot] === url) study[urlSlot] = null;
  };
  await audio.play().catch(() => toast('Could not play audio.'));
}

// ---------------------------------------------------------------- view switch

function switchView(view) {
  for (const btn of document.querySelectorAll('[data-view]')) {
    const active = btn.dataset.view === view;
    btn.classList.toggle('is-active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  $('view-study').hidden = view !== 'study';
  $('view-editor').hidden = view !== 'editor';
  $('view-utilities').hidden = view !== 'utilities';

  if (view === 'study') refreshStudyIdle();
  if (view === 'editor') renderCardList();
  if (view === 'utilities') refreshBackup();
}

// ---------------------------------------------------------------- study mode

function refreshStudyIdle() {
  $('study-active').hidden = true;
  $('study-summary').hidden = true;
  $('study-idle').hidden = false;
  const dueCount = deck.cards.filter(
    (c) => !c.archived && c.stats.dueAtSession <= deck.meta.sessionCounter + 1
  ).length;
  const total = deck.cards.filter((c) => !c.archived).length;
  $('due-summary').textContent =
    total === 0
      ? 'No cards yet — add some in the Editor.'
      : `${dueCount} card${dueCount === 1 ? '' : 's'} ready next session (${total} active).`;
  $('start-session').disabled = total === 0;
}

async function onStartSession() {
  study.queue = startSession(deck);
  study.tally = emptyTally();
  await persistDeck();
  $('study-idle').hidden = true;
  $('study-summary').hidden = true;
  $('study-active').hidden = false;
  if (study.queue.length === 0) {
    finishSession();
    return;
  }
  showNextCard();
}

function showNextCard() {
  study.current = study.queue[0];
  study.flipped = false;
  const card = findCard(deck, study.current);

  // Sometimes prompt with the English side first so the user recalls the Spanish.
  study.reversed = getPrefs().reverseCards && Math.random() < REVERSE_PROBABILITY;

  const direction = $('card-direction');
  if (study.reversed) {
    direction.textContent = 'English → Spanish';
    direction.hidden = false;
    $('card-front-pos').textContent = '';
    $('card-word').textContent = card.definition;
    $('flip-hint').textContent = 'Recall the Spanish, then tap';
  } else {
    direction.hidden = true;
    $('card-front-pos').textContent = card.pos || '';
    $('card-word').textContent = card.word;
    $('flip-hint').textContent = 'Tap to reveal';
  }

  $('card-back').hidden = true;
  $('rating-buttons').hidden = true;
  $('flip-btn').hidden = false;
  $('card').classList.remove('is-flipped');

  const done = Object.values(study.tally).reduce((a, b) => a + b, 0);
  $('study-progress').textContent = `Card ${done + 1} of ${done + study.queue.length}`;
}

async function flipCard() {
  if (study.flipped) return;
  study.flipped = true;
  const card = findCard(deck, study.current);

  // The answer is whichever side was NOT shown on the front.
  $('card-definition').textContent = study.reversed ? card.word : card.definition || '';
  $('card-pos').textContent = card.pos ? `(${card.pos})` : '';
  $('card-example').textContent = card.example || '';
  const note = $('card-note');
  note.textContent = card.note ? `Note: ${card.note}` : '';
  note.hidden = !card.note;

  const syn = $('card-synonyms');
  syn.textContent = card.synonyms.length ? `Synonyms: ${card.synonyms.join(', ')}` : '';
  const see = $('card-seealso');
  see.textContent = card.seeAlso.length ? `See also: ${card.seeAlso.join(', ')}` : '';

  const img = $('card-image');
  img.hidden = true;
  img.removeAttribute('src');
  if (card.imageId) {
    const rec = await getImage(card.imageId);
    if (rec) {
      img.src = URL.createObjectURL(rec.blob);
      img.alt = `Image for ${card.word}`;
      img.hidden = false;
      img.onload = () => URL.revokeObjectURL(img.src);
    }
  }

  const audioWrap = $('card-audio');
  audioWrap.hidden = !card.audioId;

  $('card').classList.add('is-flipped');
  $('card-back').hidden = false;
  $('flip-btn').hidden = true;

  // Show the honest consequence of each rating.
  const showProj = getPrefs().showProjectedIntervals;
  for (const btn of document.querySelectorAll('.rating-btn')) {
    const rating = Number(btn.dataset.rating);
    const projEl = btn.querySelector('[data-proj]');
    projEl.textContent = showProj ? sessionsLabel(projectInterval(card.stats, rating)) : '';
  }
  $('rating-buttons').hidden = false;
}

async function rateCurrent(rating) {
  if (!study.flipped) return;
  const card = findCard(deck, study.current);
  const { autoArchived } = reviewCard(deck, study.current, rating);
  study.tally[rating] += 1;

  if (autoArchived) await maybeStripAudioOnArchive(card);

  try {
    await persistDeck();
  } catch {
    return; // keep the card in queue on save failure
  }

  study.queue.shift();
  if (autoArchived) toast(`"${card.word}" learned — archived.`);

  if (study.queue.length === 0) finishSession();
  else showNextCard();
}

async function maybeStripAudioOnArchive(card) {
  if (!card.audioId) return;
  let pref = getPrefs().stripAudioOnAutoArchive;
  if (pref === null) {
    pref = confirm(
      'A card was auto-archived. Strip its audio recording to reclaim storage on ' +
        'auto-archive from now on? (You can keep audio by choosing Cancel.)'
    );
    setPref('stripAudioOnAutoArchive', pref);
  }
  if (pref) {
    await deleteAudio(card.audioId);
    card.audioId = null;
  }
}

function finishSession() {
  $('study-active').hidden = true;
  $('study-summary').hidden = false;
  const ul = $('summary-tally');
  ul.textContent = '';
  const total = Object.values(study.tally).reduce((a, b) => a + b, 0);
  if (total === 0) {
    const li = document.createElement('li');
    li.textContent = 'No cards were due this session.';
    ul.appendChild(li);
  } else {
    for (let r = 0; r <= 3; r++) {
      const li = document.createElement('li');
      li.textContent = `${RATING_LABELS[r]}: ${study.tally[r]}`;
      ul.appendChild(li);
    }
  }

  const lastExport = getPrefs().lastExportAt;
  const stale = !lastExport || Date.now() - new Date(lastExport).getTime() > EXPORT_REMINDER_MS;
  const reminder = $('export-reminder');
  reminder.hidden = !stale;
  if (stale) {
    reminder.textContent = lastExport
      ? "It's been a while since your last backup — head to Backup and export."
      : 'You have never exported a backup. Head to Backup and export to keep your deck safe.';
  }
}

// ---------------------------------------------------------------- editor mode

function populatePosOptions() {
  const sel = $('f-pos');
  sel.textContent = '';
  for (const pos of COMMON_POS) {
    const opt = document.createElement('option');
    opt.value = pos;
    opt.textContent = pos;
    sel.appendChild(opt);
  }
}

function renderChips(listEl, items, kind) {
  listEl.textContent = '';
  items.forEach((text, idx) => {
    const li = document.createElement('li');
    li.className = 'chip';
    const span = document.createElement('span');
    span.textContent = text;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'chip-remove';
    rm.setAttribute('aria-label', `Remove ${text}`);
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      items.splice(idx, 1);
      renderChips(listEl, items, kind);
    });
    li.append(span, rm);
    listEl.appendChild(li);
  });
}

function resetEditorForm() {
  editor.editingId = null;
  editor.synonyms = [];
  editor.seeAlso = [];
  editor.newImageBlob = null;
  editor.imageId = null;
  editor.removeImage = false;
  editor.newAudioBlob = null;
  editor.audioId = null;
  if (editor.recorder) {
    editor.recorder.cancel();
    editor.recorder = null;
  }
  if (editor.previewUrl) {
    URL.revokeObjectURL(editor.previewUrl);
    editor.previewUrl = null;
  }

  $('editor-heading').textContent = 'New card';
  $('f-word').value = '';
  $('f-definition').value = '';
  $('f-pos').value = 'noun';
  $('f-example').value = '';
  $('f-note').value = '';
  $('f-synonym-input').value = '';
  $('f-seealso-input').value = '';
  $('f-image').value = '';
  $('f-image-preview-wrap').hidden = true;
  $('f-image-preview').removeAttribute('src');
  $('f-cancel').hidden = true;
  renderChips($('f-synonyms'), editor.synonyms, 'syn');
  renderChips($('f-seealso'), editor.seeAlso, 'see');
  resetAudioControls();
}

function resetAudioControls() {
  $('f-audio-record').hidden = false;
  $('f-audio-stop').hidden = true;
  $('f-audio-play').hidden = !(editor.newAudioBlob || editor.audioId);
  $('f-audio-remove').hidden = !(editor.newAudioBlob || editor.audioId);
  $('f-audio-status').textContent = editor.newAudioBlob
    ? 'New recording ready'
    : editor.audioId
      ? 'Has audio'
      : '';
  if (!audioRecordingSupported()) {
    $('f-audio-record').disabled = true;
    $('f-audio-status').textContent = 'Recording not supported here';
  }
}

async function startEditingCard(id) {
  const card = findCard(deck, id);
  if (!card) return;
  resetEditorForm();
  editor.editingId = id;
  editor.synonyms = card.synonyms.slice();
  editor.seeAlso = card.seeAlso.slice();
  editor.imageId = card.imageId;
  editor.audioId = card.audioId;

  $('editor-heading').textContent = 'Edit card';
  $('f-word').value = card.word;
  $('f-definition').value = card.definition;
  $('f-pos').value = card.pos || 'other';
  $('f-example').value = card.example;
  $('f-note').value = card.note || '';
  $('f-cancel').hidden = false;
  renderChips($('f-synonyms'), editor.synonyms, 'syn');
  renderChips($('f-seealso'), editor.seeAlso, 'see');

  if (card.imageId) {
    const rec = await getImage(card.imageId);
    if (rec) {
      editor.previewUrl = URL.createObjectURL(rec.blob);
      $('f-image-preview').src = editor.previewUrl;
      $('f-image-preview-wrap').hidden = false;
    }
  }
  resetAudioControls();
  switchView('editor');
  $('f-word').focus();
}

async function saveCard() {
  const word = $('f-word').value.trim();
  const definition = $('f-definition').value.trim();
  if (!word || !definition) {
    toast('A card needs at least a term and a definition.');
    return;
  }

  const fields = {
    word,
    definition,
    pos: $('f-pos').value,
    example: $('f-example').value.trim(),
    note: $('f-note').value.trim(),
    synonyms: editor.synonyms.slice(),
    seeAlso: editor.seeAlso.slice(),
  };

  try {
    // Resolve image changes.
    let imageId = editor.imageId;
    if (editor.removeImage && imageId) {
      await deleteImage(imageId);
      imageId = null;
    }
    if (editor.newImageBlob) {
      if (imageId) await deleteImage(imageId);
      imageId = crypto.randomUUID();
      await putImage(imageId, editor.newImageBlob);
    }

    // Resolve audio changes.
    let audioId = editor.audioId;
    if (editor.newAudioBlob) {
      if (audioId) await deleteAudio(audioId);
      audioId = crypto.randomUUID();
      await putAudio(audioId, editor.newAudioBlob);
    }

    if (editor.editingId) {
      const card = findCard(deck, editor.editingId);
      Object.assign(card, fields, { imageId, audioId });
    } else {
      const card = createCard(fields, deck.meta.sessionCounter);
      card.imageId = imageId;
      card.audioId = audioId;
      deck.cards.push(card);
    }
    await persistDeck();
  } catch (err) {
    if (!(err instanceof QuotaError)) toast('Could not save card. ' + (err.message || err));
    return;
  }

  toast(editor.editingId ? 'Card updated.' : 'Card added.');
  resetEditorForm();
  renderCardList();
}

function cardMatchesSearch(card, q) {
  if (!q) return true;
  const hay = [card.word, card.definition, card.pos, card.note, ...card.synonyms, ...card.seeAlso]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function renderCardList() {
  const q = $('search').value.trim().toLowerCase();
  const list = $('card-list');
  list.textContent = '';

  const cards = sortCardsByWord(
    deck.cards.filter((c) => {
      if (cardFilter === 'active' && c.archived) return false;
      if (cardFilter === 'archived' && !c.archived) return false;
      return cardMatchesSearch(c, q);
    })
  );

  $('card-list-empty').hidden = cards.length > 0 || deck.cards.length === 0;
  if (deck.cards.length === 0) $('card-list-empty').hidden = false;

  for (const card of cards) {
    const li = document.createElement('li');
    li.className = 'card-row' + (card.archived ? ' is-archived' : '');

    const main = document.createElement('div');
    main.className = 'card-row-main';
    const term = document.createElement('span');
    term.className = 'card-row-word';
    term.textContent = card.word;
    const def = document.createElement('span');
    def.className = 'card-row-def';
    def.textContent = card.definition;
    main.append(term, def);
    if (card.archived) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'archived';
      main.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'card-row-actions';

    const edit = mkBtn('Edit', 'secondary-btn', () => startEditingCard(card.id));
    const arch = mkBtn(card.archived ? 'Unarchive' : 'Archive', 'secondary-btn', async () => {
      setArchived(deck, card.id, !card.archived);
      await persistDeck();
      renderCardList();
    });
    const del = mkBtn('Delete', 'danger-btn', async () => {
      if (!confirm(`Delete "${card.word}"? This cannot be undone.`)) return;
      if (card.imageId) await deleteImage(card.imageId);
      if (card.audioId) await deleteAudio(card.audioId);
      deleteCard(deck, card.id);
      await persistDeck();
      renderCardList();
      toast('Card deleted.');
    });
    actions.append(edit, arch, del);

    li.append(main, actions);
    list.appendChild(li);
  }
}

function mkBtn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ---------------------------------------------------------------- backup mode

async function refreshBackup() {
  $('opt-reverse').checked = getPrefs().reverseCards;
  const last = getPrefs().lastExportAt;
  $('last-export').textContent = last
    ? `Last export: ${new Date(last).toLocaleString()}`
    : 'No export yet.';
  const { usage, quota } = await getEstimate();
  $('storage-readout').textContent = quota
    ? `Using ${formatBytes(usage)} of ~${formatBytes(quota)} available.`
    : `Using ${formatBytes(usage)}.`;
  const persisted =
    navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  $('persist-status').textContent = persisted
    ? 'Persistent storage: granted (your deck resists eviction).'
    : 'Persistent storage: not granted.';
  $('persist-btn').hidden = persisted;
}

async function doExport() {
  try {
    const payload = await exportJSON(deck);
    payload.meta.lastExportedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `repasito-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    deck.meta.lastExportedAt = payload.meta.lastExportedAt;
    await persistDeck();
    setPref('lastExportAt', payload.meta.lastExportedAt);
    refreshBackup();
    toast('Deck exported.');
  } catch (err) {
    toast('Export failed. ' + (err.message || err));
  }
}

function selectedImportMode() {
  return document.querySelector('input[name="import-mode"]:checked').value;
}

async function applyImport(obj, mode) {
  const { deck: newDeck, imported } = await importJSON(obj, { mode });
  deck = newDeck;
  toast(`Imported. Deck now has ${imported} card${imported === 1 ? '' : 's'}.`);
  refreshBackup();
}

async function doImport() {
  const file = $('import-file').files[0];
  if (!file) return;
  const mode = selectedImportMode();
  if (mode === 'replace' && !confirm('Replace your entire current deck with this file?')) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    await applyImport(obj, mode);
    $('import-file').value = '';
    $('import-btn').disabled = true;
  } catch (err) {
    toast('Import failed: ' + (err.message || err), 5000);
  }
}

async function loadDefaultDeck() {
  const mode = selectedImportMode();
  const msg =
    mode === 'replace'
      ? 'Replace your entire current deck with the example deck?'
      : 'Add the example deck (béisbol) to your current deck?';
  if (!confirm(msg)) return;
  try {
    const res = await fetch('decks/default-deck.json');
    if (!res.ok) throw new Error(`could not load example deck (${res.status})`);
    const obj = await res.json();
    await applyImport(obj, mode);
  } catch (err) {
    toast('Could not load the example deck: ' + (err.message || err), 5000);
  }
}

// ---------------------------------------------------------------- install hint

function maybeShowInstallHint() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const standalone =
    navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (isIOS && !standalone && !getPrefs().installHintDismissed) {
    $('install-hint').hidden = false;
  }
}

// ---------------------------------------------------------------- wiring

function wireEvents() {
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  }

  // Study
  $('start-session').addEventListener('click', onStartSession);
  $('flip-btn').addEventListener('click', flipCard);
  $('card').addEventListener('click', () => {
    if (!study.flipped) flipCard();
  });
  for (const btn of document.querySelectorAll('.rating-btn')) {
    btn.addEventListener('click', () => rateCurrent(Number(btn.dataset.rating)));
  }
  $('card-audio-play').addEventListener('click', async () => {
    const card = findCard(deck, study.current);
    if (card && card.audioId) {
      const rec = await getAudio(card.audioId);
      if (rec) playBlob(rec.blob, 'audioUrl');
    }
  });
  $('summary-done').addEventListener('click', () => switchView('study'));

  // Editor — chips
  const addChip = (inputId, items, listEl, kind) => {
    const val = $(inputId).value.trim();
    if (!val) return;
    items.push(val);
    $(inputId).value = '';
    renderChips(listEl, items, kind);
    $(inputId).focus();
  };
  $('f-synonym-add').addEventListener('click', () =>
    addChip('f-synonym-input', editor.synonyms, $('f-synonyms'), 'syn')
  );
  $('f-seealso-add').addEventListener('click', () =>
    addChip('f-seealso-input', editor.seeAlso, $('f-seealso'), 'see')
  );
  $('f-synonym-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addChip('f-synonym-input', editor.synonyms, $('f-synonyms'), 'syn');
  });
  $('f-seealso-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addChip('f-seealso-input', editor.seeAlso, $('f-seealso'), 'see');
  });

  // Editor — image
  $('f-image').addEventListener('change', () => {
    const file = $('f-image').files[0];
    if (!file) return;
    editor.newImageBlob = file;
    editor.removeImage = false;
    if (editor.previewUrl) URL.revokeObjectURL(editor.previewUrl);
    editor.previewUrl = URL.createObjectURL(file);
    $('f-image-preview').src = editor.previewUrl;
    $('f-image-preview-wrap').hidden = false;
  });
  $('f-image-remove').addEventListener('click', () => {
    editor.newImageBlob = null;
    editor.removeImage = true;
    if (editor.previewUrl) {
      URL.revokeObjectURL(editor.previewUrl);
      editor.previewUrl = null;
    }
    $('f-image').value = '';
    $('f-image-preview').removeAttribute('src');
    $('f-image-preview-wrap').hidden = true;
  });

  // Editor — audio (record must start inside this tap handler for iOS)
  $('f-audio-record').addEventListener('click', async () => {
    try {
      editor.recorder = await startRecording();
      $('f-audio-record').hidden = true;
      $('f-audio-stop').hidden = false;
      $('f-audio-status').textContent = 'Recording…';
    } catch (err) {
      toast('Microphone unavailable. ' + (err.message || err));
    }
  });
  $('f-audio-stop').addEventListener('click', async () => {
    if (!editor.recorder) return;
    const blob = await editor.recorder.stop();
    editor.recorder = null;
    editor.newAudioBlob = blob;
    resetAudioControls();
    toast('Recording saved to this card on Save.');
  });
  $('f-audio-play').addEventListener('click', async () => {
    if (editor.newAudioBlob) {
      playBlob(editor.newAudioBlob, 'audioUrl');
    } else if (editor.audioId) {
      const rec = await getAudio(editor.audioId);
      if (rec) playBlob(rec.blob, 'audioUrl');
    }
  });
  $('f-audio-remove').addEventListener('click', () => {
    editor.newAudioBlob = null;
    editor.audioId = null; // cleared from card on Save
    resetAudioControls();
  });

  $('f-save').addEventListener('click', saveCard);
  $('f-cancel').addEventListener('click', () => {
    resetEditorForm();
    toast('Edit cancelled.');
  });

  // Card browser
  $('search').addEventListener('input', renderCardList);
  for (const btn of document.querySelectorAll('.filter-btn')) {
    btn.addEventListener('click', () => {
      cardFilter = btn.dataset.filter;
      for (const b of document.querySelectorAll('.filter-btn'))
        b.classList.toggle('is-active', b === btn);
      renderCardList();
    });
  }

  // Study options
  $('opt-reverse').addEventListener('change', () => {
    setPref('reverseCards', $('opt-reverse').checked);
  });

  // Backup
  $('export-btn').addEventListener('click', doExport);
  $('import-file').addEventListener('change', () => {
    $('import-btn').disabled = !$('import-file').files[0];
  });
  $('import-btn').addEventListener('click', doImport);
  $('load-default-btn').addEventListener('click', loadDefaultDeck);
  $('persist-btn').addEventListener('click', async () => {
    const granted = await requestPersist();
    toast(granted ? 'Persistent storage granted.' : 'Persistent storage was not granted.');
    refreshBackup();
  });

  // Install hint
  $('install-dismiss').addEventListener('click', () => {
    $('install-hint').hidden = true;
    setPref('installHintDismissed', true);
  });
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch {
      /* offline support is best-effort */
    }
  }
}

async function init() {
  populatePosOptions();
  resetEditorForm();
  wireEvents();

  deck = await loadOrCreateDeck();
  // Request durable storage on first run (best-effort).
  requestPersist();

  switchView('study');
  maybeShowInstallHint();
  registerServiceWorker();
}

init();
