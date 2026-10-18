// The home page without JavaScript: the ten bodies as a list of links, and the notes inline.

import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('without JavaScript the home page lists the ten bodies', async ({ page }) => {
  await page.goto('');
  const links = page.locator('nav.bodies a');
  await expect(links).toHaveCount(10);
  for (const a of await links.all()) await expect(a).toBeVisible();
  expect(await links.allTextContents()).toEqual([
    'Mercury',
    'Venus',
    'Earth',
    'Moon',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
    'Pluto',
  ]);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Planetary');
  // What needs the script is hidden; the notes are shown after the sheet.
  for (const sel of ['#orrery', 'button.info', '#pause', '#clock'])
    await expect(page.locator(sel)).toBeHidden();
  await expect(page.locator('dialog#info')).toBeVisible();
  await expect(page.locator('dialog#info')).toContainText('(r / 7375.9)^0.4');
  const [sw, iw] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(sw).toBeLessThanOrEqual(iw);
});

test('without JavaScript the home page opens at the top, with the notes not focused', async ({
  page,
}) => {
  await page.goto('');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('#info-title')).not.toBeFocused();
  // The line about pointing at planets needs the drawing, so it is left out.
  await expect(page.locator('dialog#info .js-only')).toBeHidden();
});
