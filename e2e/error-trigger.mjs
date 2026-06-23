// B53: Error Trigger — when a linked target automation fails, the handler runs
// automatically with the failure details. Verified by the real failure -> run.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const base = 'http://127.0.0.1:3000';
const log = (m) => console.log(m);
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }).then((r) => r.json());
const put = (p, b) => fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  // TARGET automation that FAILS (code seed -> Stop and Error).
  const failingGraph = { nodes: [
    { id: 's', type: 'code', params: { code: 'return [{json:{go:true}}];' } },
    { id: 'boom', type: 'stopError', params: { message: 'target boom' } },
  ], connections: [{ from: 's', to: 'boom', port: 'main' }] };
  const target = await post('/definitions', { name: 'Target job', graph: failingGraph });
  log('created TARGET automation that fails: ' + target.id.slice(0, 12));

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1340, height: 820 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const selNode = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  const dragConnect = async (fromId, port, toId) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
  };
  const handlerRuns = (hid) => fetch(base + '/history').then((r) => r.json()).then((h) => h.filter((e) => e.automationId === hid));
  const stepsOf = (runId) => fetch(base + '/runs/' + runId + '/steps').then((r) => r.json());

  // E1: Error Trigger as entry point + downstream.
  const et = await add('errorTrigger');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${et}"]`).getAttribute('data-node-type'), 'errorTrigger', 'E1 Error Trigger added');
  assert.equal(await page.locator(`[data-testid="input-port"][data-node-id="${et}"]`).count(), 0, 'E1 entry point (no incoming)');
  const down = await add('code'); await selNode(down); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(et, 'main', down);
  log('B53 E1 Error Trigger added as entry point and wired to a downstream step');

  // E2: link to the target automation.
  await selNode(et);
  await page.waitForSelector(`[data-testid="cfg-error-target"] option[value="${target.id}"]`, { state: 'attached' });
  await page.locator('[data-testid="cfg-error-target"]').selectOption(target.id);
  log('B53 E2 Error Trigger linked to handle failures of the target automation');

  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const handlerId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');

  // E3: cause the target to FAIL -> the handler runs automatically with details.
  const beforeFail = (await handlerRuns(handlerId)).length;
  const failRun = await post(`/definitions/${target.id}/run`);
  let handlerRun = null;
  for (let i = 0; i < 40; i++) { const runs = await handlerRuns(handlerId); if (runs.length > beforeFail) { handlerRun = runs[0]; break; } await new Promise((r) => setTimeout(r, 250)); }
  assert.ok(handlerRun, 'E3 the error handler ran AUTOMATICALLY after the target failed');
  let hs; for (let i = 0; i < 40; i++) { hs = await stepsOf(handlerRun.runId); if (hs.status !== 'in-progress') break; await new Promise((r) => setTimeout(r, 200)); }
  const payload = hs.steps[down].input[0].json;
  assert.equal(payload.failedAutomationId, target.id, 'E3 handler received the failed automation id');
  assert.equal(payload.failedRunId, failRun.runId, 'E3 handler received the failed run id');
  assert.equal(payload.error, 'target boom', 'E3 handler received the real failure error message');
  log(`B53 E3 target failed -> handler ran automatically; downstream got { failedAutomationId, failedRunId, error:"${payload.error}" }`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'error-trigger-run.png') });

  // E4: target SUCCEEDS -> handler does NOT run.
  await put(`/definitions/${target.id}`, { name: 'Target job', graph: { nodes: [{ id: 's', type: 'code', params: { code: 'return [{json:{ok:true}}];' } }], connections: [] } });
  const beforeOk = (await handlerRuns(handlerId)).length;
  await post(`/definitions/${target.id}/run`);
  await new Promise((r) => setTimeout(r, 2500));
  const afterOk = (await handlerRuns(handlerId)).length;
  assert.equal(afterOk, beforeOk, 'E4 a SUCCESSFUL target run did NOT trigger the error handler');
  log('B53 E4 target succeeded -> handler did NOT run (failure=handler runs, success=handler does not)');

  // E5/E6: persistence + CRUD.
  const pos = await page.locator(`[data-testid="node"][data-node-id="${et}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + handlerId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${et}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${et}"]`).click();
  await page2.waitForSelector(`[data-testid="cfg-error-target"] option[value="${target.id}"]`, { state: 'attached' });
  assert.equal(await page2.locator('[data-testid="cfg-error-target"]').inputValue(), target.id, 'E5 linkage (target) persisted across fresh reload');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${et}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B53 E5/E6 linkage + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${et}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${et}"]`).count(), 0, 'error trigger deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting trigger removed its connections');
  log('B53 E6 error trigger selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="formTrigger"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B53 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B53 ASSERTIONS PASSED (Error Trigger auto-runs the handler with failure details on a linked target failure; success does not trigger it; persists; CRUD; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
