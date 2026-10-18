// A body's page without JavaScript: NASA's rows still open their popovers (natively, through
// popovertarget) and the "?" dialog's notes and sources are shown inline after the sheet.

import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('without JavaScript the rows open their popovers and the notes are inline', async ({
  page,
}) => {
  await page.goto('saturn/');
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

  // The dialog's content follows the sheet; "?" and Pause, which need scripts, are hidden.
  const info = page.locator('dialog#info');
  await expect(info).toBeVisible();
  await expect(info).toContainText('General notes');
  await expect(info).toContainText('PL-08');
  await expect(page.locator('button.info')).toBeHidden();
  await expect(page.locator('#pause')).toBeHidden();
});
