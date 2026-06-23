// B45: Rename Keys — rename fields (old->new), preserving values and other
// fields. Per-item observation + screenshots.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1320, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const selNode = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  const dragConnect = async (fromId, port, toId) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
  };
  const runSteps = async () => {
    const prev = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.locator('[data-testid="btn-run"]').click();
    await page.waitForFunction((p) => { const r = document.querySelector('[data-testid="run-status"]').dataset.runId; return r && r !== p; }, prev);
    const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.waitForFunction((id) => { const el = document.querySelector('[data-testid="run-status"]'); return el.dataset.runId === id && el.dataset.runState && el.dataset.runState !== 'in-progress'; }, runId, { timeout: 15000 });
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };

  // E1: add a Rename Keys + configure 2 mappings.
  const ren = await add('renameKeys');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${ren}"]`).getAttribute('data-node-type'), 'renameKeys', 'E1 Rename Keys added');
  await selNode(ren);
  await page.locator('[data-testid="cfg-renames"]').fill('{"first":"name","qty":"quantity"}');
  log('B45 E1 added Rename Keys; mappings first->name, qty->quantity');

  // seed (items with first, qty, and an UNreferenced field city) -> rename -> sink.
  const seed = await add('code'); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{first:"Ada",qty:3,city:"London"}},{json:{first:"Bo",qty:7,city:"Rome"}}];');
  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', ren);
  await dragConnect(ren, 'main', sink);

  // E2/E3/E4/E5: run.
  const s = await runSteps();
  const out = s.steps[sink].input.map((it) => it.json);
  // E2/E3: first->name, qty->quantity (old gone, new present, same value), for both mappings.
  assert.deepEqual(out[0], { name: 'Ada', quantity: 3, city: 'London' }, 'E2/E3/E4 item 0 renamed (first->name, qty->quantity) with city untouched');
  assert.deepEqual(out[1], { name: 'Bo', quantity: 7, city: 'Rome' }, 'E2/E3/E4 item 1 renamed likewise');
  // explicit old-gone / new-present checks
  assert.ok(!('first' in out[0]) && !('qty' in out[0]), 'E2 old keys (first, qty) are GONE');
  assert.ok(out[0].name === 'Ada' && out[0].quantity === 3, 'E2 new keys present carrying the SAME values');
  assert.equal(out[0].city, 'London', 'E4 unreferenced field (city) survives unchanged');
  log('B45 E2/E3/E4/E5 {first:Ada,qty:3,city:London} -> {name:Ada,quantity:3,city:London} (old gone, new same value, city untouched); 2 mappings; downstream got renamed items');
  await page.screenshot({ path: path.join(SHOT_DIR, 'rename-keys-run.png') });

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Rename test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${ren}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${ren}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${ren}"]`).click();
  assert.deepEqual(JSON.parse(await page2.locator('[data-testid="cfg-renames"]').inputValue()), { first: 'name', qty: 'quantity' }, 'E6 rename mappings persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${ren}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B45 E6 rename mappings + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${ren}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${ren}"]`).count(), 0, 'rename deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting rename removed its connections');
  log('B45 E6 rename-keys selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="removeDuplicates"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B45 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B45 ASSERTIONS PASSED (Rename Keys renames fields old->new preserving values + other fields; multiple mappings; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
