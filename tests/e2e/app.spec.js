import { test, expect } from '@playwright/test';

// init() loads the deck asynchronously; wait until it has populated the study
// idle text so we don't act before the deck exists.
async function waitReady(page) {
  await expect(page.locator('#due-summary')).not.toBeEmpty();
}

async function addCard(page, word, definition) {
  await waitReady(page);
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.locator('#f-word').fill(word);
  await page.locator('#f-definition').fill(definition);
  await page.locator('#f-save').click();
  await expect(page.locator('#card-list')).toContainText(word);
}

test.describe('Fichas app', () => {
  test('creates cards that survive a reload (IndexedDB persistence)', async ({ page }) => {
    await page.goto('/');
    await addCard(page, 'el perro', 'the dog');
    await addCard(page, 'la casa', 'the house');

    await page.reload();
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await expect(page.locator('#card-list')).toContainText('el perro');
    await expect(page.locator('#card-list')).toContainText('la casa');
  });

  test('stores and retrieves an audio blob with matching size and type', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { putAudio, getAudio } = await import('/src/storage.js');
      const bytes = new Uint8Array([10, 20, 30, 40, 50, 200, 201, 202, 203]);
      const blob = new Blob([bytes], { type: 'audio/mp4' });
      await putAudio('e2e-audio', blob);
      const rec = await getAudio('e2e-audio');
      const back = new Uint8Array(await rec.blob.arrayBuffer());
      return { size: rec.blob.size, type: rec.type, first: back[0], last: back[back.length - 1] };
    });
    expect(result.size).toBe(9);
    expect(result.type).toBe('audio/mp4');
    expect(result.first).toBe(10);
    expect(result.last).toBe(203);
  });

  test('shows a clear message instead of crashing on QuotaExceededError', async ({ page }) => {
    await page.addInitScript(() => {
      const origPut = IDBObjectStore.prototype.put;
      window.__failPut = false;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__failPut) {
          throw new DOMException('Simulated quota exceeded', 'QuotaExceededError');
        }
        return origPut.apply(this, args);
      };
    });
    await page.goto('/');
    await waitReady(page); // first-run deck creation must finish before we fail puts
    await page.evaluate(() => {
      window.__failPut = true;
    });

    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.locator('#f-word').fill('lleno');
    await page.locator('#f-definition').fill('full');
    await page.locator('#f-save').click();

    await expect(page.locator('#toast')).toContainText(/storage is full/i);
    // The app is still alive and responsive.
    await expect(page.locator('.mode-btn[data-view="backup"]')).toBeVisible();
  });

  test('audio recorder selects a supported MIME type by preference, never hardcodes WebM', async ({
    page,
  }) => {
    await page.goto('/');

    // Case 1: mp4 supported -> mp4 chosen (top of preference list).
    const mp4 = await page.evaluate(async () => {
      window.MediaRecorder = window.MediaRecorder || function () {};
      window.MediaRecorder.isTypeSupported = (t) => t === 'audio/mp4';
      const { pickSupportedMimeType } = await import('/src/audio.js');
      return pickSupportedMimeType();
    });
    expect(mp4).toBe('audio/mp4');

    // Case 2: mp4 unsupported, opus supported -> opus chosen (not bare webm).
    const opus = await page.evaluate(async () => {
      window.MediaRecorder.isTypeSupported = (t) => t === 'audio/webm;codecs=opus';
      const { pickSupportedMimeType } = await import('/src/audio.js');
      return pickSupportedMimeType();
    });
    expect(opus).toBe('audio/webm;codecs=opus');

    // Case 3: nothing supported -> undefined (let the browser default; no hardcode).
    const none = await page.evaluate(async () => {
      window.MediaRecorder.isTypeSupported = () => false;
      const { pickSupportedMimeType } = await import('/src/audio.js');
      return pickSupportedMimeType();
    });
    expect(none).toBeUndefined();
  });

  test('a full study session updates scheduling honestly', async ({ page }) => {
    await page.goto('/');
    await addCard(page, 'gracias', 'thank you');

    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await page.locator('#start-session').click();
    await expect(page.locator('#card-word')).toHaveText('gracias');

    await page.locator('#flip-btn').click();
    await expect(page.locator('#card-definition')).toHaveText('thank you');
    // Projected intervals are shown under the rating buttons.
    await expect(page.locator('.rating-3 [data-proj]')).toContainText(/session/);

    await page.locator('.rating-3').click();
    await expect(page.locator('#study-summary')).toBeVisible();
    await expect(page.locator('#summary-tally')).toContainText('Easy: 1');
  });
});
