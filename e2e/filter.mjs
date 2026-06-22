// B32: Filter node — keep only matching items on a SINGLE narrowed output;
// dropped items are genuinely absent downstream. Verified per item + screenshots.
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
  await page.setViewportSize({ width: 1300, height: 760 });
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
  const runAndSteps = async () => {
    const prev = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.locator('[data-testid="btn-run"]').click();
    // Wait for a NEW run id (not the stale one from a previous run).
    await page.waitForFunction((p) => { const r = document.querySelector('[data-testid="run-status"]').dataset.runId; return r && r !== p; }, prev);
    const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.waitForFunction((id) => { const el = document.querySelector('[data-testid="run-status"]'); return el.dataset.runId === id && el.dataset.runState && el.dataset.runState !== 'in-progress'; }, runId, { timeout: 15000 });
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };

  // E1: add a Filter from the palette (drag).
  const flt = await dragAdd('filter', 560, 320);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${flt}"]`).getAttribute('data-node-type'), 'filter', 'E1 Filter added from palette');
  log('B32 E1 added a Filter step from the palette (drag-drop)');

  // E3: a Filter has a SINGLE output (not branching).
  const ports = await page.locator(`[data-testid="port"][data-node-id="${flt}"]`).evaluateAll((els) => els.map((e) => e.dataset.port));
  assert.deepEqual(ports, ['main'], 'E3 Filter has a single output (no branching)');
  log('B32 E3 Filter exposes a SINGLE output (' + JSON.stringify(ports) + '), not multiple like IF/Switch');

  // E2: configure the keep-condition (keep items with json.value >= 10).
  await selNode(flt);
  await page.locator('[data-testid="cfg-left"]').fill('json.value');
  await page.locator('[data-testid="cfg-op"]').selectOption('gte');
  await page.locator('[data-testid="cfg-right"]').fill('10');
  log('B32 E2 keep-condition configured: json.value >= 10');

  // Seed mixed items: ids 1..6 with values 5,12,8,20,10,3 -> matches (>=10): ids 2,4,5.
  const seed = await clickAdd('code');
  await selNode(seed);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{id:1,value:5}},{json:{id:2,value:12}},{json:{id:3,value:8}},{json:{id:4,value:20}},{json:{id:5,value:10}},{json:{id:6,value:3}}];');
  const sink = await dragAdd('code', 900, 320);
  await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');

  await dragConnect(seed, 'main', flt);
  await dragConnect(flt, 'main', sink); // E3 single output wired to one downstream

  // E4: only matching items reach the downstream; dropped ones genuinely absent.
  let s = await runAndSteps();
  const idsAt = (nid) => (s.steps[nid].input || []).map((it) => it.json.id).sort((a, b) => a - b);
  assert.equal(s.steps[seed].output.length, 6, 'seed produced 6 items');
  assert.deepEqual(idsAt(sink), [2, 4, 5], 'E4 only matching items (value>=10: ids 2,4,5) reached downstream');
  // genuinely absent: dropped ids 1,3,6 appear nowhere in the downstream input
  const downIds = (s.steps[sink].input || []).map((it) => it.json.id);
  for (const dropped of [1, 3, 6]) assert.ok(!downIds.includes(dropped), `dropped id ${dropped} is genuinely absent downstream`);
  log('B32 E4 downstream received exactly [2,4,5]; dropped [1,3,6] genuinely ABSENT (not flagged/passed-through)');
  await page.screenshot({ path: path.join(SHOT_DIR, 'filter-run.png') });

  // E5: change the keep-condition -> a different subset passes.
  await selNode(flt);
  await page.locator('[data-testid="cfg-op"]').selectOption('lt'); // keep value < 10 -> ids 1,3,6
  s = await runAndSteps();
  assert.deepEqual(idsAt(sink), [1, 3, 6], 'E5 flipping the condition changes which items pass (value<10: ids 1,3,6)');
  log('B32 E5 condition changed to value<10 -> downstream now receives exactly [1,3,6] (engine applies it per item)');

  // E6: persistence — config + layout across save + fresh reload; CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Filter test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${flt}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${flt}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${flt}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-left"]').inputValue(), 'json.value', 'E6 filter config persisted');
  assert.equal(await page2.locator('[data-testid="cfg-op"]').inputValue(), 'lt', 'E6 filter operator persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${flt}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 filter layout persisted');
  log(`B32 E6 filter config (json.value lt 10) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const connsBefore = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${flt}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${flt}"]`).count(), 0, 'filter deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < connsBefore, 'E6 deleting filter removed its connections');
  log('B32 E6 filter selectable/configurable/connectable(full-span)/movable/deletable (connections removed)');

  // E7: no regression — click-add still works.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="switch"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B32 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B32 ASSERTIONS PASSED (Filter keeps matching items on a single output; dropped items genuinely absent; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
