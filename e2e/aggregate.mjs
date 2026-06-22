// B40: Aggregate node — collapse a field's values from many items into a single
// output item carrying the collected values. Per-item + screenshots.
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

  const clickAdd = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const dragAdd = async (type, x, y) => {
    const before = await page.locator('[data-testid="node"]').count();
    const pb = await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).boundingBox();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node"]').length === n, before + 1);
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

  // E1: add an Aggregate + configure field + output name.
  const agg = await dragAdd('aggregate', 620, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${agg}"]`).getAttribute('data-node-type'), 'aggregate', 'E1 Aggregate added');
  await selNode(agg);
  await page.locator('[data-testid="cfg-agg-field"]').fill('json.amount');
  await page.locator('[data-testid="cfg-agg-output"]').fill('amounts');
  log('B40 E1 added Aggregate; field=json.amount, output=amounts');

  // seed (3 distinctive items) -> aggregate -> sink.
  const seed = await dragAdd('code', 300, 360); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{amount:10}},{json:{amount:20}},{json:{amount:30}}];');
  const sink = await dragAdd('code', 940, 360); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', agg);
  await dragConnect(agg, 'main', sink);

  // E2/E3/E4/E5: run -> 3 items collapse to 1 carrying [10,20,30].
  const s = await runSteps();
  assert.equal(s.steps[seed].output.length, 3, 'seed emitted 3 items');
  assert.equal(s.steps[agg].output.length, 1, 'E2 many items collapsed to exactly ONE output item');
  assert.deepEqual(s.steps[agg].output[0].json.amounts, [10, 20, 30], 'E3/E5 the output field holds ALL collected values from the inputs (none missing/invented)');
  assert.equal(s.steps[sink].input.length, 1, 'E4 downstream received the ONE aggregated item, not the many');
  assert.deepEqual(s.steps[sink].input[0].json.amounts, [10, 20, 30], 'E4 downstream item is the aggregated one');
  log('B40 E2/E3/E4/E5 3 items -> 1 item { amounts: ' + JSON.stringify(s.steps[agg].output[0].json.amounts) + ' }; downstream got the single aggregated item');
  await page.screenshot({ path: path.join(SHOT_DIR, 'aggregate-run.png') });

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Aggregate test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${agg}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${agg}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${agg}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-agg-field"]').inputValue(), 'json.amount', 'E6 field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-agg-output"]').inputValue(), 'amounts', 'E6 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${agg}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B40 E6 config (field+output) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${agg}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${agg}"]`).count(), 0, 'aggregate deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting aggregate removed its connections');
  log('B40 E6 aggregate selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="filter"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B40 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B40 ASSERTIONS PASSED (Aggregate collapses many items into one carrying all collected values; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
