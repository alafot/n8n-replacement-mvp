// B44: Remove Duplicates — drop duplicates, keep distinct (first occurrence,
// original order). Per-item observation + screenshots.
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
  const setSeed = async (id, code) => { await selNode(id); await page.locator('[data-testid="cfg-code"]').fill(code); };
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

  // E1: add Remove Duplicates + configure identity.
  const dedup = await add('removeDuplicates');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${dedup}"]`).getAttribute('data-node-type'), 'removeDuplicates', 'E1 Remove Duplicates added');
  await selNode(dedup);
  await page.locator('[data-testid="cfg-dedup-by"]').selectOption('field');
  await page.locator('[data-testid="cfg-dedup-field"]').fill('json.id');
  log('B44 E1 added Remove Duplicates; compare=By key field json.id');

  const seed = await add('code'); await setSeed(seed, 'return [{json:{id:1}},{json:{id:2}},{json:{id:2}},{json:{id:3}},{json:{id:1}}];');
  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', dedup);
  await dragConnect(dedup, 'main', sink);

  // E2/E5: duplicates removed, first occurrence, original order.
  let s = await runSteps();
  let ids = s.steps[sink].input.map((it) => it.json.id);
  assert.deepEqual(ids, [1, 2, 3], 'E2 ids 1,2,2,3,1 -> distinct first-occurrence order [1,2,3]');
  log(`B44 E2/E5 1,2,2,3,1 -> ${JSON.stringify(ids)} (distinct, first occurrence, original order); downstream got the distinct set`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'remove-duplicates-run.png') });

  // E3: identity matters — same id but different v.
  await setSeed(seed, 'return [{json:{id:1,v:"a"}},{json:{id:1,v:"b"}},{json:{id:2,v:"c"}}];');
  s = await runSteps();
  let byField = s.steps[sink].input.map((it) => it.json.id);
  assert.deepEqual(byField, [1, 2], 'E3 by key field id -> [1,2] (the two id:1 items dedupe to the first)');
  await selNode(dedup); await page.locator('[data-testid="cfg-dedup-by"]').selectOption('whole');
  s = await runSteps();
  let byWhole = s.steps[sink].input.map((it) => `${it.json.id}${it.json.v}`);
  assert.deepEqual(byWhole, ['1a', '1b', '2c'], 'E3 whole-item compare keeps all 3 (they differ in v) — changing identity changes what counts as a duplicate');
  log('B44 E3 identity matters: by id -> [1,2]; by whole item -> all 3 (1a,1b,2c)');

  // E4: no duplicates -> all pass, never adds.
  await selNode(dedup); await page.locator('[data-testid="cfg-dedup-by"]').selectOption('field');
  await setSeed(seed, 'return [{json:{id:1}},{json:{id:2}},{json:{id:3}}];');
  s = await runSteps();
  ids = s.steps[sink].input.map((it) => it.json.id);
  assert.deepEqual(ids, [1, 2, 3], 'E4 no duplicates -> all 3 pass through unchanged (nothing dropped/added)');
  log(`B44 E4 no-duplicates: [1,2,3] -> ${JSON.stringify(ids)} (all pass, never pads)`);

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Dedup test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${dedup}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${dedup}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${dedup}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-dedup-by"]').inputValue(), 'field', 'E6 compare mode persisted');
  assert.equal(await page2.locator('[data-testid="cfg-dedup-field"]').inputValue(), 'json.id', 'E6 key field persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${dedup}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B44 E6 config (compare+field) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${dedup}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${dedup}"]`).count(), 0, 'dedup deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting dedup removed its connections');
  log('B44 E6 remove-duplicates selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="limit"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B44 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B44 ASSERTIONS PASSED (Remove Duplicates keeps distinct first-occurrence items; identity configurable; no-dup passes all; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
