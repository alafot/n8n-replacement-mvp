// B33 palette redesign — capture the categorized icon palette and a hover tooltip.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const { page } = b;
  // Category headings present.
  const cats = await page.locator('[data-testid="palette-category"]').allTextContents();
  assert.ok(cats.length >= 2, 'palette has category headings');
  console.log('categories:', cats.join(' | '));
  await b.shotTo(path.join(DIR, 'palette-categories.png'));

  // Hover a node -> tooltip with name + description.
  await page.locator('[data-testid="palette-item"][data-step-type="switch"]').hover();
  await page.waitForSelector('[data-testid="palette-tooltip"]', { state: 'visible', timeout: 4000 });
  const name = await page.locator('[data-testid="tooltip-name"]').textContent();
  const desc = await page.locator('[data-testid="tooltip-desc"]').textContent();
  console.log('tooltip:', name, '—', desc);
  await b.shotTo(path.join(DIR, 'palette-tooltip-hover.png'));
  console.log('B33 OK: categories + compact icon buttons + hover tooltip captured.');
} catch (e) {
  console.error('B33 demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
