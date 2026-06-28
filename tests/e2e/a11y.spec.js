import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function criticalViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

test.describe('accessibility (axe-core)', () => {
  test('study screen has no critical/serious violations', async ({ page }) => {
    await page.goto('/');
    const violations = await criticalViolations(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('editor screen has no critical/serious violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    const violations = await criticalViolations(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('utilities screen has no critical/serious violations', async ({ page }) => {
    await page.goto('/');
    await page.locator('#utilities-btn').click();
    const violations = await criticalViolations(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
