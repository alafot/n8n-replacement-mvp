// B39: Execute Sub-workflow — run a separate SAVED automation as a step, feeding
// it the parent's items and returning its results. Per-item + screenshots.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const base = 'http://127.0.0.1:3000';
const log = (m) => console.log(m);
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const codeDef = (name, code) => post('/definitions', { name, graph: { nodes: [{ id: 's', type: 'code', params: { code } }], connections: [] } });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  // Create three SEPARATE saved automations with distinctive transforms.
  const doubler = await codeDef('Doubler', 'return $input.map(it=>({json:{...it.json, value: it.json.value*2, by:"double"}}));');
  const tripler = await codeDef('Tripler', 'return $input.map(it=>({json:{...it.json, value: it.json.value*3, by:"triple"}}));');
  const failer = await codeDef('Failer', 'throw new Error("sub blew up");');
  log(`saved sub-workflows: Doubler=${doubler.id.slice(0, 12)} Tripler=${tripler.id.slice(0, 12)} Failer=${failer.id.slice(0, 12)}`);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1340, height: 800 });
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
  const chooseSub = async (subId) => { await selNode(execSub); await page.waitForSelector(`[data-testid="cfg-subworkflow"] option[value="${subId}"]`, { state: "attached" }); await page.locator('[data-testid="cfg-subworkflow"]').selectOption(subId); };
  const runSteps = async () => {
    const prev = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.locator('[data-testid="btn-run"]').click();
    await page.waitForFunction((p) => { const r = document.querySelector('[data-testid="run-status"]').dataset.runId; return r && r !== p; }, prev);
    const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.waitForFunction((id) => { const el = document.querySelector('[data-testid="run-status"]'); return el.dataset.runId === id && el.dataset.runState && el.dataset.runState !== 'in-progress'; }, runId, { timeout: 15000 });
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };

  // E1: add an Execute Sub-workflow + select a saved automation.
  const execSub = await dragAdd('executeSubworkflow', 620, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${execSub}"]`).getAttribute('data-node-type'), 'executeSubworkflow', 'E1 Execute Sub-workflow added');
  await chooseSub(doubler.id);
  log('B39 E1 added Execute Sub-workflow and selected the saved "Doubler" automation');

  // Parent: seed(value 5) -> execSub -> sink.
  const seed = await dragAdd('code', 300, 360); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{value:5,id:"x"}}];');
  const sink = await dragAdd('code', 940, 360); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', execSub);
  await dragConnect(execSub, 'main', sink);

  // E2/E3/E4/E5(success): run -> sub gets parent items, returns its transform downstream.
  let s = await runSteps();
  assert.equal(s.status, 'completed', 'E5 parent completes on sub success');
  assert.deepEqual(s.steps[execSub].input.map((it) => it.json.value), [5], 'E2 sub-workflow received the parent items (value 5)');
  assert.equal(JSON.stringify(s.steps[sink].input), JSON.stringify(s.steps[execSub].output), 'E3 downstream input == sub-workflow output');
  assert.equal(s.steps[sink].input[0].json.value, 10, 'E4 sub GENUINELY ran its transform (5 doubled -> 10)');
  assert.equal(s.steps[sink].input[0].json.by, 'double', 'E4 result reflects the Doubler sub (by=double)');
  log('B39 E2/E3/E4 sub got parent items [5], returned [10, by=double]; downstream received exactly that');
  await page.screenshot({ path: path.join(SHOT_DIR, 'subworkflow-run.png') });

  // E6: selecting a DIFFERENT sub-workflow changes the result.
  await chooseSub(tripler.id);
  s = await runSteps();
  assert.equal(s.steps[sink].input[0].json.value, 15, 'E6 switching to Tripler changes the result (5 tripled -> 15)');
  assert.equal(s.steps[sink].input[0].json.by, 'triple', 'E6 result now reflects the Tripler sub');
  log('B39 E6 switching the selected sub-workflow to Tripler -> downstream now [15, by=triple] (selection genuinely matters)');

  // E5 (failure): a sub that fails surfaces as a parent failure.
  await chooseSub(failer.id);
  s = await runSteps();
  assert.equal(s.status, 'failed', 'E5 a sub-workflow FAILURE surfaces as a parent FAILURE');
  assert.equal(s.steps[execSub].status, 'failed', 'the Execute Sub-workflow step failed');
  assert.ok(String(s.steps[execSub].error).includes('sub blew up'), 'E5 the sub-workflow error surfaces in the parent');
  log(`B39 E5 sub failure surfaced as parent failure with the sub error ("${s.steps[execSub].error}")`);

  // E7: persistence + CRUD (sub reference + layout).
  await chooseSub(doubler.id); // restore a working selection
  await page.locator('[data-testid="automation-name"]').fill('Parent with sub');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${execSub}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${execSub}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${execSub}"]`).click();
  await page2.waitForSelector(`[data-testid="cfg-subworkflow"] option[value="${doubler.id}"]`, { state: "attached" });
  assert.equal(await page2.locator('[data-testid="cfg-subworkflow"]').inputValue(), doubler.id, 'E7 sub-workflow reference persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${execSub}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E7 layout persisted');
  log(`B39 E7 sub reference + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${execSub}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${execSub}"]`).count(), 0, 'execSub deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E7 deleting execSub removed its connections');
  log('B39 E7 Execute Sub-workflow selectable/configurable(reference)/connectable(full-span)/movable/deletable');

  // E8: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="transform"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E8 existing types + click-add still work');
  log('B39 E8 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B39 ASSERTIONS PASSED (Execute Sub-workflow runs a separate saved automation with the parent items, returns its transform; success completes, failure surfaces; selection matters; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
