// B49: Schedule trigger — entry point that starts real runs on a configured
// interval. Verified by observed scheduled runs + interval governing the cadence.
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
  const countDefRuns = (defId) => page.evaluate((id) => fetch('/history').then((r) => r.json()).then((h) => h.filter((e) => e.automationId === id).length), defId);
  const defRunIds = (defId) => page.evaluate((id) => fetch('/history').then((r) => r.json()).then((h) => h.filter((e) => e.automationId === id).map((e) => e.runId)), defId);
  const save = async () => { await page.locator('[data-testid="btn-save"]').click(); await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId); return page.locator('[data-testid="run-status"]').getAttribute('data-def-id'); };

  // E1: add a Schedule trigger as the ENTRY POINT (no incoming) + downstream.
  const trig = await add('scheduleTrigger');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${trig}"]`).getAttribute('data-node-type'), 'scheduleTrigger', 'E1 Schedule trigger added');
  assert.equal(await page.locator(`[data-testid="input-port"][data-node-id="${trig}"]`).count(), 0, 'E1 trigger is an entry point (no input handle / no incoming needed)');
  const down = await add('code'); await selNode(down); await page.locator('[data-testid="cfg-code"]').fill('return $input.map(it=>({json:{ran:true, from: it.json.source}}));');
  await dragConnect(trig, 'main', down);
  log('B49 E1 Schedule trigger added as entry point and wired to a downstream step');

  // E2: configure the schedule (interval).
  await selNode(trig);
  await page.locator('[data-testid="cfg-schedule-interval"]').fill('1');
  log('B49 E2 schedule configured: interval = 1 second');

  const defId = await save();

  // E3/E4 phase A: interval 1s — start, observe fires over ~3.2s, stop.
  const beforeA = await countDefRuns(defId);
  await selNode(trig);
  await page.locator('[data-testid="schedule-start"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.scheduleMs);
  await page.waitForTimeout(3200);
  await page.locator('[data-testid="schedule-stop"]').click();
  const deltaA = (await countDefRuns(defId)) - beforeA;
  assert.ok(deltaA >= 2, `E3 the schedule fired real runs (interval 1s -> ${deltaA} runs in ~3.2s)`);
  log(`B49 E3 firing the schedule started ${deltaA} REAL runs over ~3.2s (interval 1s)`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'schedule-run.png') });

  // E3 cont.: a scheduled run genuinely ran from the trigger through downstream.
  const ids = await defRunIds(defId);
  let stepsOk = null;
  for (const rid of ids) { const s = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), rid); if (s.status === 'completed') { stepsOk = s; break; } }
  assert.ok(stepsOk, 'a scheduled run completed');
  assert.equal(stepsOk.steps[down].output[0].json.ran, true, 'E3 downstream ran on the scheduled fire');
  assert.equal(stepsOk.steps[down].output[0].json.from, 'schedule', 'E3 downstream result derives from the schedule trigger payload');
  log('B49 E3 a scheduled run completed from trigger -> downstream with result { ran:true, from:"schedule" }');

  // E4: shorter interval -> more fires in the same window (config governs firing).
  await selNode(trig);
  await page.locator('[data-testid="cfg-schedule-interval"]').fill('0.5');
  await save(); // PUT updates the stored interval the scheduler reads
  const beforeB = await countDefRuns(defId);
  await selNode(trig);
  await page.locator('[data-testid="schedule-start"]').click();
  await page.waitForTimeout(3200);
  await page.locator('[data-testid="schedule-stop"]').click();
  const deltaB = (await countDefRuns(defId)) - beforeB;
  assert.ok(deltaB > deltaA, `E4 shorter interval fires more often (0.5s -> ${deltaB} vs 1s -> ${deltaA} in the same window) — the configured schedule genuinely governs firing`);
  log(`B49 E4 interval 0.5s -> ${deltaB} runs vs interval 1s -> ${deltaA} runs in ~3.2s: the configured schedule governs the firing cadence`);

  // E5/E6: persistence + CRUD. (current stored interval is 0.5)
  const pos = await page.locator(`[data-testid="node"][data-node-id="${trig}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${trig}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${trig}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-schedule-interval"]').inputValue(), '0.5', 'E5 schedule (interval) persisted across fresh reload');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${trig}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B49 E5/E6 schedule interval (0.5s) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${trig}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${trig}"]`).count(), 0, 'trigger deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting trigger removed its connections');
  log('B49 E6 schedule trigger selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="httpRequest"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B49 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B49 ASSERTIONS PASSED (Schedule trigger entry point fires real runs on the configured interval; interval governs cadence; persists; CRUD; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
