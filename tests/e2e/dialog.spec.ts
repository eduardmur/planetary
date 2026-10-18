// The "?" dialog every page shares: it closes on a click on its backdrop, Esc or ×, but not when a
// text selection is dragged out of it or a link in it is opened; its title line breaks only between
// items; full screen, it keeps clear of a phone's notch.

import { expect, test, type Page } from '@playwright/test';

const openInfo = async (page: Page, path: string) => {
  await page.goto(path);
  await page.locator('button.info').click();
  const dialog = page.locator('dialog#info');
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Press in the middle of the first note (plain text) and let go on the backdrop, 40 px to the
 *  left of the dialog. */
const dragOut = async (page: Page) => {
  const p = (await page.locator('#info ol.drafting li').first().boundingBox())!;
  const d = (await page.locator('dialog#info').boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + 6);
  await page.mouse.down();
  await page.mouse.move(d.x - 40, p.y + 6, { steps: 6 });
  await page.mouse.up();
};

for (const path of ['', 'saturn/']) {
  test(`${path || 'home'}: a selection dragged out of the dialog leaves it open`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'full screen on phones: no backdrop');
    const dialog = await openInfo(page, path);
    await dragOut(page);
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => String(getSelection()))).not.toBe('');
    // A plain click on the backdrop closes it.
    await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden();
  });

  test(`${path || 'home'}: opening a link from the keyboard leaves the dialog open`, async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard');
    await context.route(/nssdc|github/, (r) => r.abort());
    const dialog = await openInfo(page, path);
    const link = dialog.locator('.info-body a[href^="http"]').first();
    await link.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
    await link.focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
  });
}

test.describe('where the browser has no closedby', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      delete (HTMLDialogElement.prototype as { closedBy?: string }).closedBy;
    });
  });
  test('the script closes the dialog on its backdrop, and only there', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'full screen on phones: no backdrop');
    const dialog = await openInfo(page, 'saturn/');
    // Native light dismiss off: what closes it now is the script.
    await dialog.evaluate((d) => d.removeAttribute('closedby'));
    await dragOut(page);
    await expect(dialog).toBeVisible();
    // On the first heading of the notes: plain text.
    const h = (await dialog.locator('.info-body h3').first().boundingBox())!;
    const inside = { x: h.x + 10, y: h.y + h.height / 2 };
    // Pressed outside, let go inside: stays.
    await page.mouse.move(8, 8);
    await page.mouse.down();
    await page.mouse.move(inside.x, inside.y, { steps: 4 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    // A click inside: stays.
    await page.mouse.click(inside.x, inside.y);
    await expect(dialog).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden();
    await page.locator('button.info').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test('the title line breaks only between its items', async ({ page }) => {
  for (const width of [360, 430, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const dialog = await openInfo(page, 'mars/');
    // An item may come in several boxes (round its <time>), all on one line.
    const broken = await dialog
      .locator('.title-line .nowrap')
      .evaluateAll((spans) =>
        spans
          .filter((s) => new Set([...s.getClientRects()].map((r) => Math.round(r.top))).size > 1)
          .map((s) => s.textContent),
      );
    expect(broken, `${width}`).toEqual([]);
    // No line starts with a separator.
    const starts = await dialog.locator('.title-line').evaluate((p) => {
      const out: string[] = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let top = -Infinity;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const r = range.getBoundingClientRect();
          if (!r.height || /\s/.test(text[i]!)) continue;
          if (r.top > top + 4) out.push(text[i]!);
          top = Math.max(top, r.top);
        }
      }
      return out;
    });
    expect(starts.includes('·'), `${width}: ${starts.join('')}`).toBe(false);
  }
});

test('full screen, the dialog keeps clear of the notch', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'safe-area insets are set through the DevTools protocol');
  await page.setViewportSize({ width: 844, height: 390 });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send(
      'Emulation.setSafeAreaInsetsOverride' as never,
      {
        insets: { top: 0, left: 47, right: 47, bottom: 21 },
      } as never,
    );
  } catch {
    test.skip(true, 'this Chromium cannot set safe-area insets');
  }
  const dialog = await openInfo(page, 'uranus/');
  const [h, x, body] = await Promise.all(
    ['#info-title', 'dialog#info .close', 'dialog#info .info-body p'].map((s) =>
      page.locator(s).first().boundingBox(),
    ),
  );
  expect(h!.x).toBeGreaterThanOrEqual(47);
  expect(body!.x).toBeGreaterThanOrEqual(47);
  expect(x!.x + x!.width).toBeLessThanOrEqual(844 - 47);
  await expect(dialog).toBeVisible();
});
