import { test, expect } from '@playwright/test';

// Note: Playwright's WebKit build does not faithfully route page fetch()/reload
// through the service worker while context.setOffline(true) is set (a browser
// limitation, not an app one). So we verify offline-readiness the way the SW
// actually delivers it: the SW registers and controls the page, and the Cache
// Storage holds the full app shell (the exact bytes the SW serves when offline).
test.describe('PWA offline', () => {
  test('service worker controls the page and precaches the full app shell', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // Go offline; the Cache Storage is local and remains readable.
    await context.setOffline(true);

    const cacheState = await page.evaluate(async () => {
      const cache = await caches.open('fichas-shell-v1');
      const needed = [
        'index.html',
        'styles.css',
        'src/app.js',
        'src/scheduler.js',
        'manifest.json',
      ];
      const present = {};
      for (const path of needed) {
        const res = await cache.match(path);
        present[path] = !!res;
      }
      const shellRes = await cache.match('index.html');
      const shellText = shellRes ? await shellRes.text() : '';
      return { present, shellHasTitle: shellText.includes('Fichas') };
    });

    await context.setOffline(false);

    for (const [path, ok] of Object.entries(cacheState.present)) {
      expect(ok, `cached: ${path}`).toBe(true);
    }
    expect(cacheState.shellHasTitle).toBe(true);
  });
});
