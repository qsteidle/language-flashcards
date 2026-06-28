import { describe, it, expect } from 'vitest';
import {
  review,
  newCardStats,
  projectInterval,
  EASE_FLOOR,
  AUTO_ARCHIVE_THRESHOLD,
  RATINGS,
} from '../../src/scheduler.js';

describe('scheduler: perfect-recall streak (all Easy)', () => {
  // Expected values computed by hand from the documented rules, independent of
  // the implementation. Interval uses the pre-adjustment ease each step.
  it('produces exact interval/ease/reps/dueAtSession at each step', () => {
    let stats = newCardStats(0);

    // Review 1 @ session 1
    let r = review(stats, RATINGS.EASY, 1);
    expect(r.stats).toMatchObject({ reps: 1, interval: 1, dueAtSession: 2, reviewCount: 1 });
    expect(r.stats.ease).toBeCloseTo(2.65, 10);
    expect(r.autoArchive).toBe(false);
    stats = r.stats;

    // Review 2 @ session 2
    r = review(stats, RATINGS.EASY, 2);
    expect(r.stats).toMatchObject({ reps: 2, interval: 3, dueAtSession: 5 });
    expect(r.stats.ease).toBeCloseTo(2.8, 10);
    stats = r.stats;

    // Review 3 @ session 5: interval = round(3 * 2.80) = 8
    r = review(stats, RATINGS.EASY, 5);
    expect(r.stats).toMatchObject({ reps: 3, interval: 8, dueAtSession: 13 });
    expect(r.stats.ease).toBeCloseTo(2.95, 10);
    stats = r.stats;

    // Review 4 @ session 13: interval = round(8 * 2.95) = 24
    r = review(stats, RATINGS.EASY, 13);
    expect(r.stats).toMatchObject({ reps: 4, interval: 24, dueAtSession: 37 });
    expect(r.stats.ease).toBeCloseTo(3.1, 10);
    expect(r.autoArchive).toBe(false); // 24 < 30
    stats = r.stats;

    // Review 5 @ session 37: interval = round(24 * 3.10) = 74 -> auto-archive
    r = review(stats, RATINGS.EASY, 37);
    expect(r.stats).toMatchObject({ reps: 5, interval: 74, dueAtSession: 111 });
    expect(r.stats.ease).toBeCloseTo(3.25, 10);
    expect(r.autoArchive).toBe(true);
  });
});

describe('scheduler: lapse (rating 0) resets the card', () => {
  it('sets reps=0, interval=1, drops ease by 0.20, due next session', () => {
    // Card mid-streak: reps=2, interval=3, ease=2.80
    const stats = {
      interval: 3,
      ease: 2.8,
      reps: 2,
      dueAtSession: 5,
      lastRating: 3,
      reviewCount: 2,
    };
    const r = review(stats, RATINGS.NO, 5);
    expect(r.stats.reps).toBe(0);
    expect(r.stats.interval).toBe(1);
    expect(r.stats.ease).toBeCloseTo(2.6, 10);
    expect(r.stats.dueAtSession).toBe(6);
    expect(r.stats.lastRating).toBe(0);
  });
});

describe('scheduler: ease floor', () => {
  it('never drops ease below 1.3 on a lapse', () => {
    let stats = { interval: 1, ease: 1.4, reps: 0, dueAtSession: 0, lastRating: 0, reviewCount: 5 };
    stats = review(stats, RATINGS.NO, 1).stats; // 1.4 - 0.2 = 1.2 -> clamps to 1.3
    expect(stats.ease).toBe(EASE_FLOOR);
    stats = review(stats, RATINGS.NO, 2).stats; // stays at floor
    expect(stats.ease).toBe(EASE_FLOOR);
  });

  it('never drops ease below 1.3 on repeated Hard ratings', () => {
    let stats = newCardStats(0);
    for (let i = 0; i < 20; i++) stats = review(stats, RATINGS.HARD, i + 1).stats;
    expect(stats.ease).toBe(EASE_FLOOR);
  });
});

describe('scheduler: medium leaves ease unchanged', () => {
  it('rating 2 does not change ease', () => {
    const stats = {
      interval: 3,
      ease: 2.5,
      reps: 2,
      dueAtSession: 5,
      lastRating: 2,
      reviewCount: 2,
    };
    const r = review(stats, RATINGS.MEDIUM, 5);
    expect(r.stats.ease).toBe(2.5);
  });
});

describe('scheduler: auto-archive threshold', () => {
  it('flags when the resulting interval reaches the threshold', () => {
    // reps=3 path: interval = round(20 * 2.5) = 50 >= 30
    const stats = {
      interval: 20,
      ease: 2.5,
      reps: 3,
      dueAtSession: 0,
      lastRating: 3,
      reviewCount: 3,
    };
    const r = review(stats, RATINGS.MEDIUM, 0);
    expect(r.stats.interval).toBeGreaterThanOrEqual(AUTO_ARCHIVE_THRESHOLD);
    expect(r.autoArchive).toBe(true);
  });
});

describe('scheduler: input validation', () => {
  it('rejects out-of-range ratings', () => {
    expect(() => review(newCardStats(0), 4, 0)).toThrow();
    expect(() => review(newCardStats(0), -1, 0)).toThrow();
    expect(() => review(newCardStats(0), 1.5, 0)).toThrow();
  });
});

describe('scheduler: projectInterval', () => {
  it('previews the next interval without committing', () => {
    const stats = newCardStats(0);
    expect(projectInterval(stats, RATINGS.NO)).toBe(1);
    expect(projectInterval(stats, RATINGS.EASY)).toBe(1); // reps 0 -> 1
  });
});
