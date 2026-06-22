// Driven-browser checks for B16 (run from canvas, single action, real engine run
// matching the canvas) and B18 (live per-step status on canvas, skipped branch,
// inspect output, correlate with the engine's per-step truth from B17).
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const addNode = async (type) => {
    await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click();
    return page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
  };
  const connect = async (fromId, port, toId) => {
    await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).click();
    await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).click();
  };
  const cfg = async (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  const stepStatus = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).getAttribute('data-step-status');

  // wait(http delay) -> seed(value 40) -> gate(if>18) --true--> adult / --false--> minor
  const wait = await addNode('httpRequest');
  const seed = await addNode('code');
  const gate = await addNode('if');
  const adult = await addNode('code');
  const minor = await addNode('code');

  await cfg(wait);
  await page.locator('[data-testid="cfg-url"]').fill('http://127.0.0.1:4555/delay/2500');
  await cfg(seed);
  await page.locator('[data-testid="cfg-code"]').fill('return [{ json: { value: 40 } }];');
  await cfg(gate);
  await page.locator('[data-testid="cfg-left"]').fill('json.value');
  await page.locator('[data-testid="cfg-op"]').selectOption('gt');
  await page.locator('[data-testid="cfg-right"]').fill('18');
  await cfg(adult);
  await page.locator('[data-testid="cfg-code"]').fill('return [{ json: { decision: "ADULT", doubled: $input[0].json.value * 2 } }];');
  await cfg(minor);
  await page.locator('[data-testid="cfg-code"]').fill('return [{ json: { decision: "MINOR" } }];');

  await connect(wait, 'main', seed);
  await connect(seed, 'main', gate);
  await connect(gate, 'true', adult);
  await connect(gate, 'false', minor);
  log('built runnable automation: wait(delay)->seed(value:40)->gate(>18)-[true]->adult / [false]->minor');

  // ===== B16 =====
  log('\n========== B16: run the canvas with a SINGLE action ==========');
  await page.locator('[data-testid="btn-run"]').click(); // E1: one action
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
  const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
  assert.ok(runId && runId.startsWith('run-'), 'a run id was produced');
  log(`B16 E1/E4 single Run click started a run; UI acknowledges: "${await page.locator('[data-testid="run-status"]').textContent()}"`);

  // E2: genuine engine run — queryable on the engine.
  const engineSteps0 = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  assert.ok(engineSteps0.steps && Object.keys(engineSteps0.steps).length === 5, 'real engine run with the 5 canvas steps');
  log(`B16 E2/E5 genuine durable engine run ${runId} is queryable (engine reports ${Object.keys(engineSteps0.steps).length} steps)`);

  // ===== B18 =====
  log('\n========== B18: live status on the canvas + inspect output ==========');
  // E1/E2: observe a step go running -> completed live, WITHOUT reload.
  await page.waitForSelector(`[data-testid="node"][data-node-id="${wait}"][data-step-status="running"]`, { timeout: 8000 });
  log(`B18 E1 observed live (no reload): step ${wait} entered status "running"`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'run-live-running.png') });
  await page.waitForSelector(`[data-testid="node"][data-node-id="${wait}"][data-step-status="completed"]`, { timeout: 15000 });
  log(`B18 E2 same step transitioned live to "completed" (running -> completed on canvas)`);

  // Wait for the whole run to settle.
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runState !== 'in-progress', null, { timeout: 15000 });

  // E3: untaken branch shown 'skipped' on the canvas.
  const adultStatus = await stepStatus(adult);
  const minorStatus = await stepStatus(minor);
  assert.equal(adultStatus, 'completed', 'taken branch completed');
  assert.equal(minorStatus, 'skipped', 'untaken branch shown skipped');
  log(`B18 E3 canvas shows taken branch ${adult}="${adultStatus}", untaken branch ${minor}="${minorStatus}"`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'run-final.png') });

  // E4: inspect a step's output in standard item format.
  await cfg(adult);
  const shown = await page.locator('[data-testid="step-output"]').textContent();
  const shownObj = JSON.parse(shown);
  assert.equal(shownObj[0].json.decision, 'ADULT');
  assert.equal(shownObj[0].json.doubled, 80, 'output reflects the canvas (value 40 -> doubled 80)');
  assert.ok('binary' in shownObj[0], 'standard item format { json, binary }');
  log(`B18 E4 opened step ${adult}; its output (standard item format): ${shown.replace(/\s+/g, ' ')}`);

  // E5 / B16 E3: canvas display corresponds to the engine's actual per-step truth.
  const engineSteps = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  for (const id of [wait, seed, gate, adult, minor]) {
    const canvasStatus = await stepStatus(id);
    assert.equal(canvasStatus, engineSteps.steps[id].status, `canvas status for ${id} matches engine`);
  }
  assert.deepEqual(shownObj, engineSteps.steps[adult].output, 'inspected output matches the engine per-step output');
  log('B18 E5 canvas per-step status + inspected output MATCH the engine truth:');
  log('       ' + JSON.stringify(Object.fromEntries(Object.entries(engineSteps.steps).map(([k, v]) => [k, v.status]))));
  log(`B16 E3 distinctive canvas (value 40, ADULT branch) produced a matching run result (decision ADULT, doubled 80)`);

  log('\nALL RUN/LIVE ASSERTIONS PASSED (B16, B18).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
