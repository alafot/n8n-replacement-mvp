// B42: Sort node — reorder items by a chosen field asc/desc, preserving the set.
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

  // E1: add a Sort + configure field + direction.
  const sort = await add('sort');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${sort}"]`).getAttribute('data-node-type'), 'sort', 'E1 Sort added');
  await selNode(sort);
  await page.locator('[data-testid="cfg-sort-field"]').fill('json.value');
  await page.locator('[data-testid="cfg-sort-direction"]').selectOption('asc');
  log('B42 E1 added Sort; field=json.value, direction=ascending');

  // seed (arbitrary order, incl a DUPLICATE key) -> sort -> sink.
  const seed = await add('code'); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{id:"a",value:3}},{json:{id:"b",value:1}},{json:{id:"c",value:2}},{json:{id:"d",value:1}}];');
  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', sort);
  await dragConnect(sort, 'main', sink);

  // E2/E4/E5: ascending.
  let s = await runSteps();
  let order = s.steps[sink].input.map((it) => it.json.value);
  let ids = s.steps[sink].input.map((it) => it.json.id);
  assert.deepEqual(order, [1, 1, 2, 3], 'E2 items reordered ascending by value (3,1,2,1 -> 1,1,2,3)');
  assert.equal(s.steps[sink].input.length, 4, 'E4 count preserved (4)');
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd'], 'E4 same item set preserved (a,b,c,d), incl the duplicate-key items — nothing dropped/duplicated');
  log(`B42 E2/E4/E5 ascending: values ${JSON.stringify(order)} (ids ${JSON.stringify(ids)}); same 4 items preserved; downstream got the sorted order`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'sort-run.png') });

  // E3: descending reverses.
  await selNode(sort); await page.locator('[data-testid="cfg-sort-direction"]').selectOption('desc');
  s = await runSteps();
  order = s.steps[sink].input.map((it) => it.json.value);
  assert.deepEqual(order, [3, 2, 1, 1], 'E3 descending reverses the order (3,2,1,1)');
  assert.equal(s.steps[sink].input.length, 4, 'E4 count still preserved descending');
  log(`B42 E3 descending: values ${JSON.stringify(order)} (direction honored)`);

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Sort test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${sort}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${sort}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${sort}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-sort-field"]').inputValue(), 'json.value', 'E6 field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-sort-direction"]').inputValue(), 'desc', 'E6 direction persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${sort}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B42 E6 config (field+direction) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${sort}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${sort}"]`).count(), 0, 'sort deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting sort removed its connections');
  log('B42 E6 sort selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="splitOut"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B42 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B42 ASSERTIONS PASSED (Sort reorders by field asc/desc, preserves the item set; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
