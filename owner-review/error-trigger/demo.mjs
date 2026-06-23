// Error Trigger — sample:
//  Target "Failing target": seed -> Stop and Error('target boom')  [saved]
//  Handler "Error handler": Error Trigger(watches target) -> sink   [saved]
//  Run the target (it fails) and confirm the handler AUTO-RAN with the failure details.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const TARGET_NAME = 'Failing target (review demo)';
const HANDLER_NAME = 'Error handler (review demo)';
const b = await openBuilder();
const { page } = b;
const saveAs = async (name) => {
  await page.locator('#automation-name').fill(name);
  await page.locator('#btn-save').click();
  await page.waitForFunction(() => location.search.includes('def='));
  return page.evaluate(() => new URLSearchParams(location.search).get('def'));
};
try {
  // 1) Target that fails.
  const seed = await b.addNode('code');
  const stop = await b.addNode('stopError');
  await b.cfg(seed); await b.fill('cfg-code', 'return [{json:{x:1}}];');
  await b.cfg(stop); await b.fill('cfg-error-message', 'target boom');
  await b.connect(seed, 'main', stop);
  const targetId = await saveAs(TARGET_NAME);
  console.log('saved target:', TARGET_NAME, targetId);

  // 2) Handler watching the target.
  await page.locator('#btn-new').click();
  const trig = await b.addNode('errorTrigger');
  const sink = await b.addNode('code');
  await b.cfg(trig);
  await page.waitForFunction((tid) => { const s = document.querySelector('[data-testid="cfg-error-target"]'); return s && [...s.options].some((o) => o.value === tid); }, targetId);
  await page.locator('[data-testid="cfg-error-target"]').selectOption(targetId);
  await b.cfg(sink); await b.fill('cfg-code', 'return $input;');
  await b.connect(trig, 'main', sink);
  const handlerId = await saveAs(HANDLER_NAME);
  console.log('saved handler:', HANDLER_NAME, handlerId, 'watching', targetId);

  // 3) Run the target by reference (linkage active) -> it fails.
  const tRun = await page.evaluate((id) => fetch('/definitions/' + id + '/run', { method: 'POST' }).then((r) => r.json()), targetId);
  console.log('target run started:', tRun.runId);

  // 4) Wait for the handler to auto-run, then verify its failure details.
  let handlerRun = null;
  for (let i = 0; i < 25 && !handlerRun; i++) {
    await page.waitForTimeout(400);
    const rows = await page.evaluate((name) => fetch('/history').then((r) => r.json()).then((rs) => rs.filter((x) => x.automationName === name)), HANDLER_NAME);
    if (rows.length) handlerRun = rows[0];
  }
  assert.ok(handlerRun, 'the error handler automatically ran after the target failed');
  console.log('handler auto-ran:', handlerRun.runId, handlerRun.status);
  const s = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), handlerRun.runId);
  const blob = JSON.stringify(s.steps);
  console.log('handler downstream details:', JSON.stringify(s.steps[sink].input));
  assert.ok(blob.includes('target boom'), 'handler received the failure error message');
  assert.ok(blob.includes(targetId), 'handler received the failed automation id');

  // 5) Screenshot the history: target failed + handler completed.
  await page.locator('#btn-history').click();
  await page.waitForSelector('[data-testid="history-row"]');
  await b.shotTo(path.join(DIR, 'error-trigger-success.png'));
  console.log('Error Trigger OK: target failed -> handler auto-ran carrying {error:"target boom", failedAutomationId}.');
} catch (e) {
  console.error('Error Trigger demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
