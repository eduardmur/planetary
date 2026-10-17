// Body pages: every sheet loads without errors, draws, and links NASA's rows to its drawings; phones
// never scroll sideways.

import { expect, test } from '@playwright/test';

const SLUGS = [
  'mercury/',
  'venus/',
  'earth/',
  'moon/',
  'mars/',
  'jupiter/',
  'saturn/',
  'uranus/',
  'neptune/',
  'pluto/',
];

for (const slug of SLUGS) {
  test(`sheet /${slug} draws without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(slug);
    // View A is filled (the key plan may wait for a tap on phones).
    const paths = page.locator('#view-a path[d]:not([d=""])');
    await expect.poll(async () => paths.count()).toBeGreaterThan(8);
    // Twenty NASA rows.
    await expect(page.locator('table.main tbody tr[data-key]')).toHaveCount(20);
    // No horizontal scroll on the page itself.
    const [sw, iw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sw).toBeLessThanOrEqual(iw);
    expect(errors).toEqual([]);
  });
}

test('pointing at a drawn row lights up its geometry and shows its definition', async ({
  page,
  isMobile,
}) => {
  await page.goto('saturn/');
  const row = page.locator('tr[data-key="obliquity"]');
  if (isMobile) await row.tap();
  else await row.hover();
  await expect(row).toHaveClass(/hot/);
  await expect(page.locator('#view-a [data-ref~="obliquity"].hot').first()).toBeAttached();
  await expect(page.locator('#definition .term')).toContainText('Obliquity');
  // On phones the definition opens under the row that was tapped.
  if (isMobile) await expect(page.locator('tr.def-row #definition')).toBeVisible();
});

test('a pinned row stays in focus until it is released', async ({ page, isMobile }) => {
  await page.goto('mars/');
  const row = page.locator('tr[data-key="orbitalEccentricity"]');
  if (isMobile) {
    await row.tap();
    await expect(row).toHaveClass(/hot/);
    await row.tap();
    await expect(row).not.toHaveClass(/hot/);
    return;
  }
  await row.click();
  await page.mouse.move(5, 5);
  await expect(row).toHaveClass(/hot/);
  await expect(page).toHaveURL(/#orbitalEccentricity$/);
  await page.keyboard.press('Escape');
  await expect(row).not.toHaveClass(/hot/);
  // Keyboard focus pins a row, and Enter keeps it pinned.
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveClass(/hot/);
});

test('ring radii stay clear of the key plan', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the key plan is not an inset on phones');
  for (const slug of ['saturn/', 'neptune/', 'uranus/', 'jupiter/']) {
    await page.goto(`${slug}#ringSystem`);
    await expect(page.locator('#view-a [data-ref~="ringSystem"].hot').first()).toBeAttached();
    const overlaps = await page.evaluate(() => {
      const kp = document.querySelector('.key-plan')!.getBoundingClientRect();
      const svg = document.getElementById('view-a')!;
      const at = svg.getBoundingClientRect();
      const out: string[] = [];
      for (const el of svg.querySelectorAll<SVGPathElement>('[class*="layer-text"] path[d]')) {
        if (!el.getAttribute('d')) continue;
        const b = el.getBBox();
        const x0 = at.left + b.x,
          y0 = at.top + b.y;
        if (
          x0 + b.width > kp.left + 1 &&
          y0 + b.height > kp.top + 1 &&
          x0 < kp.right &&
          y0 < kp.bottom
        )
          out.push(el.getAttribute('data-ref') ?? '');
      }
      return out;
    });
    expect(overlaps, slug).toEqual([]);
  }
});

test('a deep link opens with its row in focus', async ({ page }) => {
  await page.goto('uranus/#magneticField');
  await expect(page.locator('tr[data-key="magneticField"]')).toHaveClass(/hot/);
  await expect(page.locator('#view-a [data-ref~="magneticField"]').first()).toBeAttached();
});

test('arrow keys move between sheets', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  await page.goto('mars/');
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/jupiter\/$/);
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/mars\/$/);
});
