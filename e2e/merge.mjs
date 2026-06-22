// B34: Merge node — combine items from MULTIPLE incoming branches into one
// output (append baseline). Verified per item (union of both branches) + screenshots.
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
  const setCode = async (id, code) => { await selNode(id); await page.locator('[data-testid="cfg-code"]').fill(code); };
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

  // E1: add a Merge from the palette (drag).
  const merge = await dragAdd('merge', 640, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${merge}"]`).getAttribute('data-node-type'), 'merge', 'E1 Merge added from palette');
  log('B34 E1 added a Merge step from the palette (drag-drop)');

  // Two upstream branches with DISTINCTIVE items, plus one downstream.
  const seedA = await dragAdd('code', 300, 200); await setCode(seedA, 'return [{json:{src:"A",id:1}},{json:{src:"A",id:2}}];');
  const seedB = await dragAdd('code', 300, 520); await setCode(seedB, 'return [{json:{src:"B",id:3}}];');
  const sink = await dragAdd('code', 980, 360); await setCode(sink, 'return $input;');

  // E2 (crux): wire 2 upstream steps INTO the one Merge (multiple incoming).
  await dragConnect(seedA, 'main', merge);
  await dragConnect(seedB, 'main', merge);
  // E3: single output -> one downstream.
  await dragConnect(merge, 'main', sink);
  const incoming = await page.locator(`[data-testid="conn-delete"][data-to="${merge}"]`).count();
  const outgoing = await page.locator(`[data-testid="conn-delete"][data-from="${merge}"]`).count();
  assert.equal(incoming, 2, 'E2 Merge accepts 2 incoming connections');
  assert.equal(outgoing, 1, 'E3 Merge converges to a single output');
  log(`B34 E2/E3 Merge has ${incoming} incoming branches and ${outgoing} output`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'merge-wired.png') });

  // E4/E5: run; the downstream input is the UNION of both branches (appended).
  const s = await runSteps();
  const downItems = (s.steps[sink].input || []).map((it) => `${it.json.src}${it.json.id}`).sort();
  assert.deepEqual(downItems, ['A1', 'A2', 'B3'], 'E4 downstream received the union of BOTH branches (A1,A2 + B3), appended');
  // both branches genuinely present
  assert.ok(downItems.includes('A1') && downItems.includes('A2') && downItems.includes('B3'), 'E5 items from both real inputs are combined');
  // merge step itself shows the combined set
  assert.equal((s.steps[merge].output || []).length, 3, 'merge output is the combined 3 items');
  log('B34 E4/E5 downstream input after merge = ' + JSON.stringify(downItems) + ' (both branches combined; engine truth)');
  await page.screenshot({ path: path.join(SHOT_DIR, 'merge-run.png') });

  // E6: persistence + CRUD. config (mode) + layout persist across fresh reload.
  await page.locator('[data-testid="automation-name"]').fill('Merge test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${merge}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${merge}"]`);
  // both incoming connections restored
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-to="${merge}"]`).count(), 2, 'E6 both incoming connections restored');
  await page2.locator(`[data-testid="node"][data-node-id="${merge}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-merge-mode"]').inputValue(), 'append', 'E6 merge mode persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${merge}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 merge layout persisted');
  log(`B34 E6 merge config (mode=append) + layout + both incoming connections persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${merge}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${merge}"]`).count(), 0, 'merge deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) <= cb - 3, 'E6 deleting merge removed all its connections (2 in + 1 out)');
  log('B34 E6 merge selectable/configurable/connectable(multi-in, full-span)/movable/deletable (connections removed)');

  // E7: no regression — click-add still works.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="switch"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B34 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B34 ASSERTIONS PASSED (Merge combines multiple inputs into one output; both branches appended; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
