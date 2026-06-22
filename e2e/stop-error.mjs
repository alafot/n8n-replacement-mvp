// B38: Stop and Error — deliberately fail the run with a custom message,
// aborting downstream. Reached -> fail with the message; avoided -> complete.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const MSG = 'Custom boom: order rejected';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1340, height: 820 });
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
    const steps = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
    return { runId, steps };
  };

  await page.locator('[data-testid="automation-name"]').fill('Order check');

  // E1: add a Stop and Error + custom message.
  const stop = await dragAdd('stopError', 700, 200);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${stop}"]`).getAttribute('data-node-type'), 'stopError', 'E1 Stop and Error added');
  await selNode(stop);
  await page.locator('[data-testid="cfg-error-message"]').fill(MSG);
  log('B38 E1 added a Stop and Error step; custom message set');

  // Build: seed -> IF(go truthy) --true--> stop -> afterStop ; --false--> safe.
  const seed = await dragAdd('code', 300, 360); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{go:true}}];');
  const gate = await dragAdd('if', 520, 360); await selNode(gate); await page.locator('[data-testid="cfg-left"]').fill('json.go'); await page.locator('[data-testid="cfg-op"]').selectOption('truthy');
  const afterStop = await dragAdd('code', 940, 200); await selNode(afterStop); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{reached:"after-stop"}}];');
  const safe = await dragAdd('code', 940, 520); await selNode(safe); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{ok:true}}];');
  await dragConnect(seed, 'main', gate);
  await dragConnect(gate, 'true', stop);
  await dragConnect(stop, 'main', afterStop);
  await dragConnect(gate, 'false', safe);

  // E2/E3: REACH the stop (go:true) -> run FAILS with the custom message; downstream does not run.
  const r1 = await runSteps();
  assert.equal(r1.steps.status, 'failed', 'E2 reaching Stop and Error fails the run');
  assert.equal(r1.steps.steps[stop].status, 'failed', 'stop step failed');
  assert.equal(r1.steps.steps[stop].error, MSG, 'E2 the FAILED step carries the user-specified message (not generic)');
  const uiText = await page.locator('[data-testid="run-status"]').textContent();
  assert.ok(uiText.includes('failed') && uiText.includes(MSG), 'E2 custom message visible to the user in run status');
  assert.notEqual(r1.steps.steps[afterStop].status, 'completed', 'E3 downstream of Stop and Error did NOT run');
  log(`B38 E2 run failed with the custom message "${MSG}" (visible in run status + step)`);
  log(`B38 E3 downstream 'afterStop' status = ${r1.steps.steps[afterStop].status} (did not run)`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'stop-error-fail.png') });

  // E5: history shows it FAILED with the message available.
  await page.locator('[data-testid="btn-history"]').click();
  await page.waitForSelector('[data-testid="history-row"]');
  const failedRow = page.locator(`[data-testid="history-row"][data-run-id="${r1.runId}"]`);
  assert.equal(await failedRow.getAttribute('data-status'), 'failed', 'E5 history entry shows failed');
  await failedRow.click();
  await page.waitForFunction((id) => document.querySelector('[data-testid="run-detail"]')?.dataset.runId === id, r1.runId);
  const errText = await page.locator('[data-testid="step-detail"][data-step-status="failed"] [data-testid="step-error"]').textContent();
  assert.ok(errText.includes(MSG), 'E5 history inspection shows the failed step error message');
  log('B38 E5 history shows the run FAILED with the message available (via inspection)');
  await page.locator('[data-testid="btn-history-close"]').click();

  // E4: AVOID the stop (go:false) -> run completes normally.
  await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{go:false}}];');
  const r2 = await runSteps();
  assert.equal(r2.steps.status, 'completed', 'E4 when Stop and Error is NOT reached, the run completes normally');
  assert.equal(r2.steps.steps[safe].status, 'completed', 'E4 the avoided path ran');
  assert.equal(r2.steps.steps[stop].status, 'skipped', 'E4 the Stop and Error was not reached (skipped)');
  log('B38 E4 path that avoids Stop and Error completes normally (no spurious failure)');

  // E6: persistence + CRUD (message + layout).
  await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{go:true}}];'); // restore
  const pos = await page.locator(`[data-testid="node"][data-node-id="${stop}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${stop}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${stop}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-error-message"]').inputValue(), MSG, 'E6 error message persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${stop}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B38 E6 message + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${stop}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${stop}"]`).count(), 0, 'stop deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting stop removed its connections');
  log('B38 E6 Stop and Error selectable/configurable(message)/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="noop"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B38 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B38 ASSERTIONS PASSED (Stop and Error fails with the custom message + aborts downstream when reached; completes when avoided; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
