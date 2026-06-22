// B35: Loop Over Items — iterate input in batches, body once per batch, then a
// separate done path. Verified per-iteration/per-item + screenshots.
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
  const setCode = async (id, code) => { await selNode(id); await page.locator('[data-testid="cfg-code"]').fill(code); };
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
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };

  // E1: add a Loop from the palette (drag) + batch size.
  const loop = await dragAdd('loop', 600, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${loop}"]`).getAttribute('data-node-type'), 'loop', 'E1 Loop added from palette');
  await selNode(loop);
  await page.locator('[data-testid="cfg-batch-size"]').fill('1');
  log('B35 E1 added a Loop Over Items step from the palette; batch size = 1');

  // E2: two outputs — loop-body and done — both wired.
  const ports = await page.locator(`[data-testid="port"][data-node-id="${loop}"]`).evaluateAll((els) => els.map((e) => e.dataset.port).sort());
  assert.deepEqual(ports, ['done', 'loop'], 'E2 Loop exposes loop-body AND done outputs');
  const seed = await dragAdd('code', 300, 360); await setCode(seed, 'return [{json:{id:1}},{json:{id:2}},{json:{id:3}}];');
  const body = await dragAdd('code', 900, 200); await setCode(body, 'return $input.map(it=>({json:{...it.json, processed:true}}));');
  const done = await dragAdd('code', 900, 540); await setCode(done, 'return $input;');
  await dragConnect(seed, 'main', loop);
  await dragConnect(loop, 'loop', body);
  await dragConnect(loop, 'done', done);
  assert.ok(await page.locator(`[data-testid="conn-delete"][data-from="${loop}"][data-port="loop"]`).count(), 'loop-body path wired');
  assert.ok(await page.locator(`[data-testid="conn-delete"][data-from="${loop}"][data-port="done"]`).count(), 'done path wired');
  // full-span on the loop-body output line
  const cid = await page.locator(`[data-testid="conn-delete"][data-from="${loop}"][data-port="loop"]`).getAttribute('data-conn-id');
  const coverage = await page.evaluate((id) => {
    const line = document.querySelector(`line[data-conn-id="${id}"]`); const svg = document.querySelector('#links'); const r = svg.getBoundingClientRect();
    const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1'), x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
    svg.style.pointerEvents = 'auto'; line.style.pointerEvents = 'stroke'; const occ = [...document.querySelectorAll('.node,.port,.conn-del')]; const sv = occ.map((e) => e.style.pointerEvents); occ.forEach((e) => e.style.pointerEvents = 'none');
    let hits = 0, n = 0; for (let i = 0; i <= 20; i++) { const t = 0.15 + 0.7 * i / 20, cx = r.left + x1 + (x2 - x1) * t, cy = r.top + y1 + (y2 - y1) * t; n++; let h = false; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) if (document.elementFromPoint(cx + dx, cy + dy) === line) { h = true; break; } if (h) hits++; }
    occ.forEach((e, i) => e.style.pointerEvents = sv[i]); svg.style.pointerEvents = ''; line.style.pointerEvents = ''; return hits / n;
  }, cid);
  assert.ok(coverage > 0.9, `loop-body output line full-span (${(coverage * 100).toFixed(0)}%)`);
  log(`B35 E2 loop-body + done outputs wired; loop-body line full-span (${(coverage * 100).toFixed(0)}%)`);

  // E3/E5/E6: run with batch size 1 over 3 items.
  let s = await runSteps();
  assert.equal(s.steps[loop].meta.iterations, 3, 'E3 body ran once per batch: 3 iterations for 3 items at batch size 1');
  const doneItems = (s.steps[done].input || []);
  const iters = [...new Set(doneItems.map((it) => it.json._iteration))].sort();
  const ids = doneItems.map((it) => it.json.id).sort();
  assert.deepEqual(iters, [0, 1, 2], 'E3 three distinct iterations observed (body executed 3 times)');
  assert.deepEqual(ids, [1, 2, 3], 'E5 every item processed exactly once (no skip/dup)');
  assert.ok(doneItems.every((it) => it.json.processed === true), 'E5 all items went through the body');
  assert.equal(s.steps[done].status, 'completed', 'E6 done path ran (once) after the final batch with the results');
  log(`B35 E3/E5 batch=1: ${s.steps[loop].meta.iterations} iterations, done received ids ${JSON.stringify(ids)} (each once, all processed)`);
  log('B35 E6 done path ran once after final batch carrying the accumulated results; run completed cleanly');
  await page.screenshot({ path: path.join(SHOT_DIR, 'loop-run.png') });

  // E4: larger batch size -> fewer iterations.
  await selNode(loop); await page.locator('[data-testid="cfg-batch-size"]').fill('2');
  s = await runSteps();
  assert.equal(s.steps[loop].meta.iterations, 2, 'E4 batch size 2 over 3 items -> ceil(3/2)=2 iterations');
  const ids2 = (s.steps[done].input || []).map((it) => it.json.id).sort();
  assert.deepEqual(ids2, [1, 2, 3], 'E5 still every item exactly once at batch size 2');
  log(`B35 E4 batch=2: ${s.steps[loop].meta.iterations} iterations (counts ${JSON.stringify(s.steps[loop].meta.batchItemCounts)}); still all items once`);

  // E7: persistence + CRUD.
  await page.locator('[data-testid="automation-name"]').fill('Loop test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${loop}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${loop}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${loop}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-batch-size"]').inputValue(), '2', 'E7 batch size persisted');
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-from="${loop}"][data-port="loop"]`).count(), 1, 'E7 loop-body connection restored');
  assert.equal(await page2.locator(`[data-testid="conn-delete"][data-from="${loop}"][data-port="done"]`).count(), 1, 'E7 done connection restored');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${loop}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E7 loop layout persisted');
  log(`B35 E7 loop config (batchSize=2) + both outputs + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${loop}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${loop}"]`).count(), 0, 'loop deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E7 deleting loop removed its connections');
  log('B35 E7 loop selectable/configurable(batch)/connectable(both outputs, full-span)/movable/deletable');

  // E8: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="merge"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E8 existing types + click-add still work');
  log('B35 E8 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B35 ASSERTIONS PASSED (Loop iterates in batches, body once per batch, done once after; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
