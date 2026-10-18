// A body's page without JavaScript: NASA's rows still open their popovers (natively, through
// popovertarget, one at a time) and the "?" dialog's notes and sources are shown inline after the
// sheet.

import { expect, test, type Page } from '@playwright/test';

test.use({ javaScriptEnabled: false });

const near = async (page: Page, key: string) => {
  const [d, r] = await page.evaluate(
    (k) =>
      [`#def-${k}`, `tr[data-key="${k}"]`].map((s) => {
        const b = document.querySelector(s)!.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      }),
    key,
  );
  return Math.min(Math.abs(d!.top - r!.bottom), Math.abs(d!.bottom - r!.top));
};

test('without JavaScript the rows open their popovers and the notes are inline', async ({
  page,
}) => {
  await page.goto('saturn/');
  // The page opens at its top: nothing takes focus on load.
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#info-title')).not.toBeFocused();
  await expect(page.locator('table.main tbody tr[data-key]')).toHaveCount(20);
  await expect(page.locator('.noscript')).toBeVisible();
  // The tabs and the home link are plain links.
  await expect(page.locator('.tabs .strip a')).toHaveCount(10);

  const def = page.locator('#def-obliquity');
  await expect(def).toBeHidden();
  await page.locator('#b-obliquity').click();
  await expect(def).toBeVisible();
  await expect(def).toContainText('right hand rule');
  await def.locator('.close').click();
  await expect(def).toBeHidden();

  // The dialog's content follows the sheet; "?" and Pause, which need scripts, are hidden, and so
  // are the notes about what needs them.
  const info = page.locator('dialog#info');
  await expect(info).toBeVisible();
  await expect(info).toContainText('General notes');
  await expect(info).toContainText('PL-08');
  await expect(page.locator('button.info')).toBeHidden();
  await expect(page.locator('#pause')).toBeHidden();
  await expect(info.locator('.js-only').first()).toBeHidden();
  await expect(info.locator('.nojs-only')).toBeVisible();
  await expect(page.locator('.steps')).toBeHidden();
});

test('without JavaScript one popover is open at a time, beside its own row', async ({
  page,
  isMobile,
}) => {
  await page.goto('saturn/');
  // On a phone the sheet docks at the foot of the screen: rows near the top stay in reach.
  const pairs = isMobile
    ? [
        ['mass', 'diameter'],
        ['diameter', 'density'],
      ]
    : [
        ['mass', 'obliquity'],
        ['obliquity', 'diameter'],
      ];
  for (const [first, second] of pairs as [string, string][]) {
    await page.locator(`#b-${first}`).click();
    await expect(page.locator(`#def-${first}`)).toBeVisible();
    await page.locator(`#b-${second}`).click();
    await expect(page.locator(`#def-${second}`)).toBeVisible();
    await expect(page.locator('.def:popover-open')).toHaveCount(1);
    // Phones in portrait dock it at the foot of the screen instead.
    if (!isMobile) expect(await near(page, second)).toBeLessThanOrEqual(6);
    await page.keyboard.press('Escape');
    await expect(page.locator('.def:popover-open')).toHaveCount(0);
  }
});
