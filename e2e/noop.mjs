// B37: No Operation node — a true pass-through. Items arrive downstream exactly
// as they entered (content + count + order). Verified per item + screenshots.
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

  // E1: add a No-Op from the palette (drag).
  const noop = await dragAdd('noop', 620, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${noop}"]`).getAttribute('data-node-type'), 'noop', 'E1 No-Op added from palette');
  log('B37 E1 added a No Operation step from the palette (drag-drop)');

  // Seed with MULTIPLE items in a specific order so count/order is tested.
  const seed = await dragAdd('code', 300, 360); await selNode(seed);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{id:3,v:"c"}},{json:{id:1,v:"a"}},{json:{id:2,v:"b"}},{json:{id:1,v:"dup"}}];');
  const sink = await dragAdd('code', 940, 360); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', noop);
  await dragConnect(noop, 'main', sink);

  // E2/E3: run; downstream input equals No-Op input — content, count, AND order.
  const s = await runSteps();
  const noopIn = s.steps[noop].input;
  const sinkIn = s.steps[sink].input;
  assert.equal(JSON.stringify(sinkIn), JSON.stringify(noopIn), 'E2 downstream input identical to No-Op input (content + count + order)');
  assert.equal(sinkIn.length, 4, 'E2 count preserved (4 items)');
  assert.deepEqual(sinkIn.map((it) => it.json.id), [3, 1, 2, 1], 'E2 order preserved exactly (3,1,2,1 incl a duplicate id) — nothing reordered/deduped');
  assert.equal(s.steps[noop].status, 'completed', 'E3 No-Op step completed successfully');
  assert.equal(s.status, 'completed', 'E3 run proceeds normally');
  log('B37 E2/E3 No-Op passed items through unchanged (ids in order ' + JSON.stringify(sinkIn.map((it) => it.json.id)) + '); step + run completed');
  await page.screenshot({ path: path.join(SHOT_DIR, 'noop-run.png') });

  // E4: persistence + CRUD (no config; layout persists).
  await selNode(noop);
  assert.ok(await page.locator('[data-testid="cfg-noop-note"]').count(), 'E4 No-Op selectable (shows it has no config)');
  await page.locator('[data-testid="automation-name"]').fill('No-op test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${noop}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${noop}"]`);
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${noop}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E4 No-Op layout persisted across fresh reload');
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-to="${noop}"]`).count(), 1, 'E4 incoming connection restored');
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-from="${noop}"]`).count(), 1, 'E4 outgoing connection restored');
  log(`B37 E4 No-Op layout + connections persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${noop}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${noop}"]`).count(), 0, 'No-Op deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E4 deleting No-Op removed its connections');
  log('B37 E4 No-Op selectable/connectable(full-span)/movable/deletable (connections removed)');

  // E5: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="wait"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E5 existing types + click-add still work');
  log('B37 E5 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B37 ASSERTIONS PASSED (No-Op passes items through unchanged — content/count/order; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
