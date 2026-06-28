// Session-based SM-2 scheduler, adapted to a 0-3 recall scale.
//
// IMPORTANT (honesty invariant): every value returned here is the deterministic
// output of the rules below applied to a real rating. There is no "boost",
// "auto-pass", or shortcut. Do not add one. See tests/unit/scheduler.test.js
// and tests/unit/no-tampering.test.js which lock this behaviour down.

export const RATINGS = Object.freeze({
  NO: 0, // blank / failed recall
  HARD: 1,
  MEDIUM: 2,
  EASY: 3,
});

export const RATING_LABELS = Object.freeze(['No', 'Hard', 'Medium', 'Easy']);

export const DEFAULT_EASE = 2.5;
export const EASE_FLOOR = 1.3;
// After an update, an interval this large (in sessions) flags the card for
// auto-archive — it has been learned well enough to leave the rotation.
export const AUTO_ARCHIVE_THRESHOLD = 30;

/** Stats for a freshly created card (before any review). */
export function newCardStats(dueAtSession = 0) {
  return {
    interval: 1,
    ease: DEFAULT_EASE,
    reps: 0,
    dueAtSession,
    lastRating: null,
    reviewCount: 0,
  };
}

function clampEase(ease) {
  return Math.max(EASE_FLOOR, ease);
}

/**
 * Apply one review to a card's stats. Pure: returns new stats, does not mutate.
 *
 * @param {object} stats   current card.stats
 * @param {number} rating  0-3
 * @param {number} sessionCounter  meta.sessionCounter at review time
 * @returns {{ stats: object, autoArchive: boolean }}
 */
export function review(stats, rating, sessionCounter) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 3) {
    throw new RangeError(`rating must be an integer 0-3, got ${rating}`);
  }

  let { interval, ease, reps } = stats;

  if (rating === RATINGS.NO) {
    reps = 0;
    interval = 1; // due next session
    ease = clampEase(ease - 0.2);
  } else {
    reps = reps + 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.round(interval * ease);

    // Ease adjustment by rating (interval above used the pre-adjustment ease).
    // MEDIUM (rating 2) deliberately leaves ease unchanged.
    if (rating === RATINGS.HARD) ease = clampEase(ease - 0.15);
    else if (rating === RATINGS.EASY) ease = ease + 0.15;
  }

  const nextStats = {
    interval,
    ease,
    reps,
    dueAtSession: sessionCounter + interval,
    lastRating: rating,
    reviewCount: stats.reviewCount + 1,
  };

  return { stats: nextStats, autoArchive: interval >= AUTO_ARCHIVE_THRESHOLD };
}

/**
 * What interval would result from a given rating, without committing it.
 * Used in Study mode to show the consequence under each rating button.
 */
export function projectInterval(stats, rating) {
  return review(stats, rating, 0).stats.interval;
}

/** A card is due when the session counter has reached its dueAtSession. */
export function isDue(card, sessionCounter) {
  return !card.archived && card.stats.dueAtSession <= sessionCounter;
}

/** Non-archived cards that are due this session (unshuffled, stable order). */
export function dueCards(cards, sessionCounter) {
  return cards.filter((c) => isDue(c, sessionCounter));
}

/** Fisher-Yates shuffle. Accepts an injectable rng for deterministic tests. */
export function shuffle(arr, rng = Math.random) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
