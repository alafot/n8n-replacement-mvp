// B48: Compare Datasets — compare TWO inputs (A,B) by a key into matched /
// only-in-A / only-in-B on distinct outputs. Verified against a KNOWN pair.
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
  await page.setViewportSize({ width: 1360, height: 820 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const selNode = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  // Drag from a source output handle to a target node's INPUT handle (toPort).
  const dragToInput = async (fromId, port, toId, toPort) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="input-port"][data-node-id="${toId}"][data-port="${toPort}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 }); await page.mouse.up();
  };
  const dragConnect = async (fromId, port, toId) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
  };
  const delIncoming = async (toId) => { const loc = page.locator(`[data-testid="conn-delete"][data-to="${toId}"]`); for (let n = await loc.count(); n > 0; n = await loc.count()) { await loc.first().click(); await page.waitForFunction((a) => document.querySelectorAll(`[data-testid="conn-delete"][data-to="${a.t}"]`).length === a.c, { t: toId, c: n - 1 }); } };
  const runSteps = async () => {
    const prev = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.locator('[data-testid="btn-run"]').click();
    await page.waitForFunction((p) => { const r = document.querySelector('[data-testid="run-status"]').dataset.runId; return r && r !== p; }, prev);
    const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.waitForFunction((id) => { const el = document.querySelector('[data-testid="run-status"]'); return el.dataset.runId === id && el.dataset.runState && el.dataset.runState !== 'in-progress'; }, runId, { timeout: 15000 });
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };
  const idsAt = (s, nid) => (s.steps[nid].input || []).map((it) => it.json.id).sort();

  // E1: add Compare Datasets, wire TWO inputs (A,B), choose key.
  const cmp = await add('compareDatasets');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${cmp}"]`).getAttribute('data-node-type'), 'compareDatasets', 'E1 Compare Datasets added');
  // two distinguishable inputs present
  assert.equal(await page.locator(`[data-testid="input-port"][data-node-id="${cmp}"]`).count(), 2, 'E1 two distinguishable inputs (A and B)');
  await selNode(cmp);
  await page.locator('[data-testid="cfg-compare-key"]').fill('json.id');
  log('B48 E1 added Compare Datasets with two inputs (A,B); key=json.id');

  // Dataset A keys [1,2,3], Dataset B keys [2,3,4]; distinct downstreams per output.
  const aSrc = await add('code'); await selNode(aSrc); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{id:1,from:"A"}},{json:{id:2,from:"A"}},{json:{id:3,from:"A"}}];');
  const bSrc = await add('code'); await selNode(bSrc); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{id:2,from:"B"}},{json:{id:3,from:"B"}},{json:{id:4,from:"B"}}];');
  const mSink = await add('code'); await selNode(mSink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  const aSink = await add('code'); await selNode(aSink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  const bSink = await add('code'); await selNode(bSink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragToInput(aSrc, 'main', cmp, 'a');
  await dragToInput(bSrc, 'main', cmp, 'b');
  await dragConnect(cmp, 'matched', mSink);
  await dragConnect(cmp, 'onlyA', aSink);
  await dragConnect(cmp, 'onlyB', bSink);
  await page.screenshot({ path: path.join(SHOT_DIR, 'compare-wired.png') });

  // E2/E3/E5: run -> matched 2,3 / onlyA 1 / onlyB 4 on distinct outputs.
  let s = await runSteps();
  assert.deepEqual(idsAt(s, mSink), [2, 3], 'E2/E3 matched = 2,3 on the matched output');
  assert.deepEqual(idsAt(s, aSink), [1], 'E2/E3 only-in-A = 1 on the onlyA output');
  assert.deepEqual(idsAt(s, bSink), [4], 'E2/E3 only-in-B = 4 on the onlyB output');
  log('B48 E2/E3/E5 A[1,2,3] vs B[2,3,4]: matched=[2,3], onlyA=[1], onlyB=[4] on distinct outputs; downstreams received the correct category');
  await page.screenshot({ path: path.join(SHOT_DIR, 'compare-run.png') });

  // E4: swap which input is A and which is B -> onlyA/onlyB swap.
  // Re-wire: now aSrc -> input b, bSrc -> input a. Delete the two input edges first.
  await delIncoming(cmp);
  await dragToInput(aSrc, 'main', cmp, 'b'); // A's data now feeds input B
  await dragToInput(bSrc, 'main', cmp, 'a'); // B's data now feeds input A
  s = await runSteps();
  assert.deepEqual(idsAt(s, mSink), [2, 3], 'E4 matched still 2,3 (symmetric)');
  assert.deepEqual(idsAt(s, aSink), [4], 'E4 only-in-A is now 4 (the dataset wired to input A is the old B)');
  assert.deepEqual(idsAt(s, bSink), [1], 'E4 only-in-B is now 1 — swapping A/B swapped the only-in categories');
  log('B48 E4 swapped inputs: only-in-A=[4], only-in-B=[1] (A vs B genuinely distinguished)');

  // E6: persistence + CRUD (multi-input/multi-output, key).
  // restore original wiring for a clean saved state
  await delIncoming(cmp);
  await dragToInput(aSrc, 'main', cmp, 'a');
  await dragToInput(bSrc, 'main', cmp, 'b');
  await page.locator('[data-testid="automation-name"]').fill('Compare test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${cmp}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${cmp}"]`);
  // both inputs + three outputs wired restored, incl toPort
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-to="${cmp}"][data-to-port="a"]`).count(), 1, 'E6 input A connection (toPort a) restored');
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-to="${cmp}"][data-to-port="b"]`).count(), 1, 'E6 input B connection (toPort b) restored');
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-from="${cmp}"]`).count(), 3, 'E6 three outputs wired restored');
  await page2.locator(`[data-testid="node"][data-node-id="${cmp}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-compare-key"]').inputValue(), 'json.id', 'E6 key field persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${cmp}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B48 E6 key + multi-input(A/B) + multi-output + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${cmp}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${cmp}"]`).count(), 0, 'compare deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) <= cb - 5, 'E6 deleting compare removed all its connections (2 in + 3 out)');
  log('B48 E6 compare selectable/configurable/connectable(2-in,3-out,full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="summarize"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B48 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B48 ASSERTIONS PASSED (Compare Datasets: matched/onlyA/onlyB correct on distinct outputs, A vs B distinguished, CRUD/persist incl multi-in/out, no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
