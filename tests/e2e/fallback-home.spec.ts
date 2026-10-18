// When the script does not run (the bundle fails to load, a 404 after a deploy, a blocked script, an
// error), every page falls back to its layout without JavaScript: the home page lists the ten bodies.
// And without JavaScript no page loads scrolled down to the notes.

import { expect, test, type Page } from '@playwright/test';

const listed = async (page: Page) => {
  const links = page.locator('nav.bodies a');
  await expect(links).toHaveCount(10);
  for (const a of await links.all()) await expect(a).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Planetary');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#pause')).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(0);
};

const failures = {
  abort: (r: import('@playwright/test').Route) => r.abort(),
  '404': (r: import('@playwright/test').Route) => r.fulfill({ status: 404, body: 'Not found' }),
  throws: (r: import('@playwright/test').Route) =>
    r.fulfill({ contentType: 'text/javascript', body: "throw new Error('x');" }),
};

for (const [name, route] of Object.entries(failures)) {
  test(`home: a bundle that ${name === 'throws' ? 'throws' : `fails (${name})`} leaves the ten links`, async ({
    page,
  }) => {
    page.on('pageerror', () => {});
    await page.route('**/assets/entry-*.js', route);
    await page.goto('');
    await listed(page);
    await expect(page.locator('html')).not.toHaveClass(/\bjs\b/);
  });
}

test('body: a bundle that fails falls back to NASA’s rows', async ({ page }) => {
  await page.route('**/assets/entry-*.js', (r) => r.abort());
  await page.goto('saturn/');
  await expect(page.locator('html')).not.toHaveClass(/\bjs\b/);
  // The note that the drawings need the script shows, though scripts as such are on.
  await expect(page.locator('.noscript')).toBeVisible();
  await page.locator('#b-obliquity').click();
  await expect(page.locator('#def-obliquity')).toBeVisible();
});

test('a page whose script runs keeps its layout', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('html')).toHaveClass(/\bjs\b.*\blive\b|\blive\b.*\bjs\b/);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the home page opens at its top, with the ten links', async ({ page }) => {
    await page.goto('');
    await listed(page);
    await expect(page.locator('#info-title')).not.toBeFocused();
  });
});
