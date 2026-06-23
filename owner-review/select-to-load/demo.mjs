// Select-to-load (B54 fix) — clicking Load shows a modal LIST of saved automations by name;
// picking one (a click, no typing an id) opens it on the canvas.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
const { page } = b;
try {
  // Ensure there is at least one saved automation to pick (save a small one).
  const seed = await b.addNode('code');
  await b.cfg(seed); await b.fill('cfg-code', 'return [{json:{hello:"world"}}];');
  await page.locator('#automation-name').fill('Pick-me (review demo)');
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => location.search.includes('def='));

  // Start fresh, then open Load.
  await page.locator('#btn-new').click();
  await page.locator('#btn-load').click();
  await page.waitForSelector('[data-testid="load-item"]');
  const names = await page.locator('[data-testid="load-item-name"]').allTextContents();
  console.log('Load list shows', names.length, 'automations by name, e.g.:', JSON.stringify(names.slice(0, 4)));
  assert.ok(names.length >= 1, 'Load presents a selectable list of saved automations by name');
  assert.ok(names.includes('Pick-me (review demo)'), 'the just-saved automation appears in the list by name');
  await b.shotTo(path.join(DIR, 'select-to-load-list.png')); // the selectable list

  // Pick one BY CLICKING (no id typing) and confirm it opens.
  const target = page.locator('[data-testid="load-item"]').filter({ hasText: 'Pick-me (review demo)' });
  await target.click();
  await page.waitForFunction(() => document.querySelector('#automation-name').value === 'Pick-me (review demo)');
  await page.waitForSelector('[data-testid="node"]');
  const loadedName = await page.locator('#automation-name').inputValue();
  const nodeCount = await page.locator('[data-testid="node"]').count();
  console.log('picked by click -> loaded:', loadedName, '| nodes restored:', nodeCount);
  assert.equal(loadedName, 'Pick-me (review demo)', 'clicking the list item opened that automation');
  assert.ok(nodeCount >= 1, 'the chosen automation restored its steps');
  await b.shotTo(path.join(DIR, 'select-to-load-opened.png'));
  console.log('Select-to-load OK: pick from a named list (no id typing) and it opens.');
} catch (e) {
  console.error('Select-to-load demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
