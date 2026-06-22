// Wait node — sample workflow: seed -> Wait(2500ms) -> sink. Confirm the run genuinely
// pauses (~the configured duration) at the Wait, items pass through unchanged, and it
// completes. Captures a mid-run screenshot (Wait running, downstream not yet) + final.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const WAIT_MS = 2500;
const b = await openBuilder();
try {
  const { page } = b;
  const seed = await b.addNode('code');
  const wait = await b.addNode('wait');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [{ json: { token: "X", n: 7 } }];');
  await b.cfg(wait);
  await b.fill('cfg-wait-ms', String(WAIT_MS));
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', wait);
  await b.connect(wait, 'main', sink);
  console.log(`built: seed -> wait(${WAIT_MS}ms) -> sink`);

  const t0 = Date.now();
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
  const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');

  // Mid-run: catch the Wait step while it is pausing the run.
  try {
    await page.waitForSelector(`[data-testid="node"][data-node-id="${wait}"][data-step-status="running"]`, { timeout: 4000 });
    await b.cfg(wait);
    await b.shotTo(path.join(DIR, 'wait-pausing.png'));
    console.log('captured mid-run: Wait step is running (run paused here)');
  } catch { console.log('(mid-run pause window not captured — proceeding)'); }

  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runState !== 'in-progress', null, { timeout: 30000 });
  const elapsed = Date.now() - t0;
  console.log('run wall-time:', elapsed, 'ms (wait configured', WAIT_MS, 'ms)');

  const s = await b.engineSteps(runId);
  assert.equal(s.steps[wait].status, 'completed', 'wait step completed');
  assert.equal(s.steps[sink].status, 'completed', 'downstream ran after the wait');
  assert.ok(elapsed >= WAIT_MS - 500, `run genuinely paused ~${WAIT_MS}ms (measured ${elapsed}ms)`);
  // items pass through unchanged
  const into = s.steps[wait].input, outOf = s.steps[sink].input;
  assert.deepEqual(outOf, into, 'items passed through the Wait unchanged');
  console.log('pass-through ok; downstream got the same items:', JSON.stringify(outOf.map((i) => i.json)));

  await b.cfg(sink);
  await b.shotTo(path.join(DIR, 'wait-success.png'));
  console.log('Wait OK: run paused ~configured duration, items passed through, completed.');
} catch (e) {
  console.error('Wait demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
