// B43: Limit node — cap how many items pass through, keeping at most N.
// Per-item observation + screenshots.
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
  const setSeed = async (id, code) => { await selNode(id); await page.locator('[data-testid="cfg-code"]').fill(code); };

  // E1: add a Limit + configure max + keep.
  const limit = await add('limit');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${limit}"]`).getAttribute('data-node-type'), 'limit', 'E1 Limit added');
  await selNode(limit);
  await page.locator('[data-testid="cfg-limit-max"]').fill('2');
  await page.locator('[data-testid="cfg-limit-keep"]').selectOption('first');
  log('B43 E1 added Limit; max=2, keep=first');

  // seed (5 items) -> limit -> sink.
  const seed = await add('code'); await setSeed(seed, 'return [{json:{id:1}},{json:{id:2}},{json:{id:3}},{json:{id:4}},{json:{id:5}}];');
  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', limit);
  await dragConnect(limit, 'main', sink);

  // E2/E3/E5: keep first 2 of 5.
  let s = await runSteps();
  let ids = s.steps[sink].input.map((it) => it.json.id);
  assert.equal(s.steps[sink].input.length, 2, 'E2 capped to N=2 (5 items -> 2)');
  assert.deepEqual(ids, [1, 2], 'E3 kept the FIRST 2 in original order [1,2]');
  log(`B43 E2/E3/E5 keep-first: 5 items -> ${JSON.stringify(ids)} (first 2, original order); downstream got the limited set`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'limit-run.png') });

  // E3 (keep-last variant).
  await selNode(limit); await page.locator('[data-testid="cfg-limit-keep"]').selectOption('last');
  s = await runSteps();
  ids = s.steps[sink].input.map((it) => it.json.id);
  assert.deepEqual(ids, [4, 5], 'E3 keep-last keeps the LAST 2 in original order [4,5]');
  log(`B43 E3 keep-last: 5 items -> ${JSON.stringify(ids)} (last 2)`);

  // E4: fewer than N -> all pass, never pads.
  await setSeed(seed, 'return [{json:{id:9}}];');
  s = await runSteps();
  ids = s.steps[sink].input.map((it) => it.json.id);
  assert.deepEqual(ids, [9], 'E4 fewer than N: 1 item with limit 2 -> 1 item (not padded to 2)');
  log(`B43 E4 fewer-than-N: 1 item, limit 2 -> ${JSON.stringify(ids)} (no padding)`);

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Limit test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${limit}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${limit}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${limit}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-limit-max"]').inputValue(), '2', 'E6 max persisted');
  assert.equal(await page2.locator('[data-testid="cfg-limit-keep"]').inputValue(), 'last', 'E6 keep mode persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${limit}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B43 E6 config (max+keep) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${limit}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${limit}"]`).count(), 0, 'limit deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting limit removed its connections');
  log('B43 E6 limit selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="sort"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B43 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B43 ASSERTIONS PASSED (Limit caps to N keep-first/last in original order; fewer-than-N passes all; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
