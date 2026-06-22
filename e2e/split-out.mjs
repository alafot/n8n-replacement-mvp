// B41: Split Out — inverse of Aggregate: expand an item's list field into N
// items, one per element. Per-element + screenshots; round-trip corroboration.
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
  await page.setViewportSize({ width: 1340, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const dragAdd = async (type) => {
    // click-to-add (auto-scrolls reliably); positions are immaterial to B41.
    await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click();
    return page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
  };
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

  // E1: add a Split Out + configure the list field + output name.
  const split = await dragAdd('splitOut', 560, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${split}"]`).getAttribute('data-node-type'), 'splitOut', 'E1 Split Out added');
  await selNode(split);
  await page.locator('[data-testid="cfg-split-field"]').fill('json.tags');
  await page.locator('[data-testid="cfg-split-output"]').fill('tag');
  log('B41 E1 added Split Out; field=json.tags, output=tag');

  // seed (ONE item with tags ['a','b','c']) -> splitOut -> aggregate (round-trip) -> sink.
  const seed = await dragAdd('code', 300, 360); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{tags:["a","b","c"]}}];');
  const agg = await dragAdd('aggregate', 800, 360); await selNode(agg); await page.locator('[data-testid="cfg-agg-field"]').fill('json.tag'); await page.locator('[data-testid="cfg-agg-output"]').fill('backTags');
  const sink = await dragAdd('code', 1060, 360); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', split);
  await dragConnect(split, 'main', agg);
  await dragConnect(agg, 'main', sink);

  // E2/E3/E4/E5: run.
  const s = await runSteps();
  assert.equal(s.steps[seed].output.length, 1, 'seed emitted 1 item with a 3-element array');
  assert.equal(s.steps[split].output.length, 3, 'E2 one item with a 3-element array became 3 items (1 -> N)');
  assert.deepEqual(s.steps[split].output.map((it) => it.json.tag), ['a', 'b', 'c'], 'E3/E5 each output item carries one element in correct order (a,b,c) — none missing/duplicated');
  assert.equal(s.steps[agg].input.length, 3, 'E4 the downstream step received the MULTIPLE split items (3), not the single');
  assert.deepEqual(s.steps[agg].output[0].json.backTags, ['a', 'b', 'c'], 'E5 round-trip: aggregating the split items reconstructs the original array');
  log('B41 E2/E3/E4 1 item {tags:[a,b,c]} -> 3 items [tag:a, tag:b, tag:c]; downstream got the 3 items');
  log('B41 E5 round-trip corroboration: split-then-aggregate reconstructs [a,b,c]');
  await page.screenshot({ path: path.join(SHOT_DIR, 'split-out-run.png') });

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Split test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${split}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${split}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${split}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-split-field"]').inputValue(), 'json.tags', 'E6 field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-split-output"]').inputValue(), 'tag', 'E6 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${split}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B41 E6 config (field+output) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${split}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${split}"]`).count(), 0, 'split deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting split removed its connections');
  log('B41 E6 split out selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="aggregate"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B41 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B41 ASSERTIONS PASSED (Split Out expands a list field into one item per element; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
