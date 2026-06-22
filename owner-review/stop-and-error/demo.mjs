// Stop and Error — two scenarios:
//  (A) reached: seed -> Stop and Error("Halt: invalid record") -> sink. Run FAILS with the
//      message, downstream sink does NOT run.
//  (B) not reached: seed(value 5) -> IF(value>100) -[true]-> StopError / -[false]-> sink.
//      false branch taken, run completes normally (no spurious failure).
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MSG = 'Halt: invalid record';

// ---- Scenario A: failure when reached ----
{
  const b = await openBuilder();
  try {
    const { page } = b;
    const seed = await b.addNode('code');
    const stop = await b.addNode('stopError');
    const sink = await b.addNode('code');
    await b.cfg(seed); await b.fill('cfg-code', 'return [{json:{id:1}}];');
    await b.cfg(stop); await b.fill('cfg-error-message', MSG);
    await b.cfg(sink); await b.fill('cfg-code', 'return $input;');
    await b.connect(seed, 'main', stop);
    await b.connect(stop, 'main', sink);

    const runId = await b.run();
    const runState = await page.locator('[data-testid="run-status"]').getAttribute('data-run-state');
    const statusText = await page.locator('[data-testid="run-status"]').textContent();
    const s = await b.engineSteps(runId);
    console.log('A) run-state:', runState, '| status text:', statusText.trim());
    assert.equal(runState, 'failed', 'run ended FAILED when Stop and Error was reached');
    assert.ok(statusText.includes(MSG), 'the user-specified error message is shown');
    assert.notEqual(s.steps[sink].status, 'completed', 'downstream sink did NOT run');
    await b.cfg(stop);
    await b.shotTo(path.join(DIR, 'stop-error-failed.png'));
    console.log('A OK: failed with message, downstream did not run. sink status =', s.steps[sink].status);
  } catch (e) { console.error('Scenario A FAILED:', e.stack || e.message); process.exitCode = 1; }
  finally { await b.close(); }
}

// ---- Scenario B: not reached -> completes normally ----
{
  const b = await openBuilder();
  try {
    const { page } = b;
    const seed = await b.addNode('code');
    const gate = await b.addNode('if');
    const stop = await b.addNode('stopError');
    const sink = await b.addNode('code');
    await b.cfg(seed); await b.fill('cfg-code', 'return [{json:{value:5}}];');
    await b.cfg(gate);
    await b.fill('cfg-left', 'json.value'); await b.select('cfg-op', 'gt'); await b.fill('cfg-right', '100');
    await b.cfg(stop); await b.fill('cfg-error-message', MSG);
    await b.cfg(sink); await b.fill('cfg-code', 'return $input;');
    await b.connect(seed, 'main', gate);
    await b.connect(gate, 'true', stop);
    await b.connect(gate, 'false', sink);

    const runId = await b.run();
    const runState = await page.locator('[data-testid="run-status"]').getAttribute('data-run-state');
    const s = await b.engineSteps(runId);
    console.log('B) run-state:', runState, '| stopError status:', s.steps[stop].status, '| sink status:', s.steps[sink].status);
    assert.notEqual(runState, 'failed', 'run completed normally when Stop and Error not reached');
    assert.equal(s.steps[sink].status, 'completed', 'false branch (sink) ran');
    assert.notEqual(s.steps[stop].status, 'completed', 'stopError not reached (untaken branch)');
    await b.shotTo(path.join(DIR, 'stop-error-not-reached.png'));
    console.log('B OK: not reached -> run completed normally, no spurious failure.');
  } catch (e) { console.error('Scenario B FAILED:', e.stack || e.message); process.exitCode = 1; }
  finally { await b.close(); }
}
