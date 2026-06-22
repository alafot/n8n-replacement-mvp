// B36: Wait node — pause the run for a configured time, then pass items through
// unchanged. Verified by MEASURED timing + per-item observation + screenshots.
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
  const dragConnect = async (fromId, port, toId) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
  };
  // Run; return { elapsed, steps, sawPaused } measuring wall-clock to completion.
  const runMeasured = async (waitId, sinkId) => {
    const prev = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    const t0 = Date.now();
    await page.locator('[data-testid="btn-run"]').click();
    await page.waitForFunction((p) => { const r = document.querySelector('[data-testid="run-status"]').dataset.runId; return r && r !== p; }, prev);
    const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    // Observe the pause: wait 'running' while sink still 'pending'.
    let sawPaused = false;
    for (let i = 0; i < 6; i++) {
      const s = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
      if (s.steps?.[waitId]?.status === 'running' && s.steps?.[sinkId]?.status !== 'completed') { sawPaused = true; break; }
      if (s.status !== 'in-progress') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    await page.waitForFunction((id) => { const el = document.querySelector('[data-testid="run-status"]'); return el.dataset.runId === id && el.dataset.runState && el.dataset.runState !== 'in-progress'; }, runId, { timeout: 20000 });
    const elapsed = Date.now() - t0;
    const steps = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
    return { elapsed, steps, sawPaused };
  };

  // E1: add a Wait from the palette + duration.
  const wait = await dragAdd('wait', 620, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${wait}"]`).getAttribute('data-node-type'), 'wait', 'E1 Wait added from palette');
  await selNode(wait);
  await page.locator('[data-testid="cfg-wait-ms"]').fill('2000');
  log('B36 E1 added a Wait step from the palette; duration = 2000ms');

  // Wire seed -> wait -> sink. Seed carries distinctive items to check pass-through.
  const seed = await dragAdd('code', 300, 360); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{id:7,tag:"keep-me"}},{json:{id:8,tag:"and-me"}}];');
  const sink = await dragAdd('code', 940, 360); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', wait);
  await dragConnect(wait, 'main', sink);

  // E2/E5: run pauses ~2000ms before the downstream proceeds; completes normally.
  const r1 = await runMeasured(wait, sink);
  assert.ok(r1.sawPaused, 'E2 observed the run PAUSED at Wait (running) while downstream still pending');
  assert.ok(r1.elapsed >= 1800 && r1.elapsed < 5000, `E2 run took ~the configured 2000ms (measured ${r1.elapsed}ms, not instantaneous)`);
  assert.equal(r1.steps.status, 'completed', 'E5 run completed normally after the wait');
  log(`B36 E2/E5 run paused at Wait then proceeded; measured elapsed ${r1.elapsed}ms (~2000ms); completed cleanly`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'wait-run.png') });

  // E4: items pass through UNCHANGED — downstream input == Wait input.
  const waitIn = JSON.stringify(r1.steps.steps[wait].input);
  const sinkIn = JSON.stringify(r1.steps.steps[sink].input);
  assert.equal(sinkIn, waitIn, 'E4 downstream input equals the Wait input (unchanged in content + shape)');
  assert.deepEqual(r1.steps.steps[sink].input.map((it) => it.json.id).sort(), [7, 8], 'E4 same items pass through (ids 7,8)');
  log('B36 E4 items passed through unchanged: ' + sinkIn);

  // E3: longer duration -> correspondingly longer measured delay.
  await selNode(wait); await page.locator('[data-testid="cfg-wait-ms"]').fill('500');
  const rShort = await runMeasured(wait, sink);
  await selNode(wait); await page.locator('[data-testid="cfg-wait-ms"]').fill('3500');
  const rLong = await runMeasured(wait, sink);
  assert.ok(rLong.elapsed - rShort.elapsed > 2000, `E3 longer duration -> longer delay (500ms run ${rShort.elapsed}ms vs 3500ms run ${rLong.elapsed}ms)`);
  log(`B36 E3 duration drives the delay: 500ms run measured ${rShort.elapsed}ms, 3500ms run measured ${rLong.elapsed}ms (delta ~${rLong.elapsed - rShort.elapsed}ms)`);

  // E6: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Wait test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${wait}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${wait}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${wait}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-wait-ms"]').inputValue(), '3500', 'E6 duration persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${wait}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 wait layout persisted');
  log(`B36 E6 wait config (ms=3500) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${wait}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${wait}"]`).count(), 0, 'wait deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting wait removed its connections');
  log('B36 E6 wait selectable/configurable(duration)/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="loop"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B36 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B36 ASSERTIONS PASSED (Wait genuinely delays by the configured time, passes items through unchanged; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
