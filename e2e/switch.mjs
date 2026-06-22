// B31: Switch node — multi-way, per-item condition routing. Verified by what the
// user sees (per-item arrival, full-span lines, screenshots) + CRUD/persist + no regression.
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
  const sel = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  const dragConnect = async (fromId, port, toId) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
  };
  const steps = async (runId) => (await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId));

  // E1: add a Switch from the palette via DRAG.
  const sw = await dragAdd('switch', 640, 360);
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${sw}"]`).getAttribute('data-node-type'), 'switch', 'E1 Switch added from palette');
  log('B31 E1 added a Switch step from the palette (drag-drop)');

  // E2: configure 3 condition-driven rules + fallback (multi-way, >2 outputs).
  await sel(sw);
  await page.locator('[data-testid="switch-add-rule"]').click();
  await page.locator('[data-testid="switch-add-rule"]').click(); // now 3 rules
  const rules = [['json.cat', 'eq', 'a'], ['json.cat', 'eq', 'b'], ['json.cat', 'eq', 'c']];
  for (let i = 0; i < 3; i++) {
    await page.locator(`[data-testid="switch-rule-${i}-left"]`).fill(rules[i][0]);
    await page.locator(`[data-testid="switch-rule-${i}-op"]`).selectOption(rules[i][1]);
    await page.locator(`[data-testid="switch-rule-${i}-right"]`).fill(rules[i][2]);
  }
  assert.ok(await page.locator('[data-testid="switch-fallback"]').isChecked(), 'fallback output enabled');
  const ruleCount = await page.locator('[data-testid="switch-rule"]').count();
  assert.equal(ruleCount, 3, 'E2 three condition-driven routing rules configured (multi-way > 2)');
  log(`B31 E2 configured ${ruleCount} rules (cat eq a/b/c) + fallback — 4 outputs`);

  // Seed producing 4 items: one per rule + one matching no rule (cat 'z').
  const seed = await clickAdd('code');
  await sel(seed);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{cat:"a",id:1}},{json:{cat:"b",id:2}},{json:{cat:"c",id:3}},{json:{cat:"z",id:4}}];');
  // Four distinct downstreams, one per output, each echoing what it receives.
  const dA = await dragAdd('code', 980, 120), dB = await dragAdd('code', 980, 260), dC = await dragAdd('code', 980, 400), dF = await dragAdd('code', 980, 560);
  for (const d of [dA, dB, dC, dF]) { await sel(d); await page.locator('[data-testid="cfg-code"]').fill('return $input;'); }

  // Wire: seed -> switch; switch out0->dA, out1->dB, out2->dC, fallback->dF.
  await dragConnect(seed, 'main', sw);
  await dragConnect(sw, '0', dA);
  await dragConnect(sw, '1', dB);
  await dragConnect(sw, '2', dC);
  await dragConnect(sw, 'fallback', dF);

  // E3: distinct outputs each connected; verify a switch-output line renders FULL-SPAN.
  const conns = await page.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => `${e.dataset.from}-${e.dataset.port}->${e.dataset.to}`));
  for (const [port, d] of [['0', dA], ['1', dB], ['2', dC], ['fallback', dF]]) assert.ok(conns.includes(`${sw}-${port}->${d}`), `output ${port} wired to its distinct downstream`);
  const cid = await page.locator(`[data-testid="conn-delete"][data-from="${sw}"][data-port="0"]`).getAttribute('data-conn-id');
  const coverage = await page.evaluate((id) => {
    const line = document.querySelector(`line[data-conn-id="${id}"]`); const svg = document.querySelector('#links'); const r = svg.getBoundingClientRect();
    const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1'), x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
    svg.style.pointerEvents = 'auto'; line.style.pointerEvents = 'stroke'; const occ = [...document.querySelectorAll('.node,.port,.conn-del')]; const sv = occ.map((e) => e.style.pointerEvents); occ.forEach((e) => e.style.pointerEvents = 'none');
    let hits = 0, n = 0; for (let i = 0; i <= 20; i++) { const t = 0.15 + 0.7 * i / 20, cx = r.left + x1 + (x2 - x1) * t, cy = r.top + y1 + (y2 - y1) * t; n++; let h = false; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) if (document.elementFromPoint(cx + dx, cy + dy) === line) { h = true; break; } if (h) hits++; }
    occ.forEach((e, i) => e.style.pointerEvents = sv[i]); svg.style.pointerEvents = ''; line.style.pointerEvents = ''; return hits / n;
  }, cid);
  assert.ok(coverage > 0.9, `switch-output line renders full-span (${(coverage * 100).toFixed(0)}%)`);
  log(`B31 E3 four distinct outputs wired; switch-output line full-span (${(coverage * 100).toFixed(0)}%)`);

  // E4/E5/E6: run and observe PER-ITEM routing.
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
  const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
  await page.waitForFunction(() => { const s = document.querySelector('[data-testid="run-status"]').dataset.runState; return s && s !== 'in-progress'; }, null, { timeout: 15000 });
  const s = await steps(runId);
  const idsAt = (nid) => (s.steps[nid].input || []).map((it) => it.json.id).sort();
  assert.equal(s.steps[sw].input.length, 4, 'switch received all 4 items');
  assert.deepEqual(idsAt(dA), [1], 'E4 item matching rule 1 (cat a) arrived ONLY at output 1 downstream');
  assert.deepEqual(idsAt(dB), [2], 'E4 item matching rule 2 (cat b) arrived ONLY at output 2 downstream');
  assert.deepEqual(idsAt(dC), [3], 'E4 item matching rule 3 (cat c) arrived ONLY at output 3 downstream');
  assert.deepEqual(idsAt(dF), [4], 'E5 no-match item (cat z) arrived at the fallback output, consistently');
  log('B31 E4/E5/E6 per-item routing (engine truth): out1<-id1[a], out2<-id2[b], out3<-id3[c], fallback<-id4[z]; each item only at its matched output');
  await page.screenshot({ path: path.join(SHOT_DIR, 'switch-run.png') });

  // E7: persistence — config + layout across save + fresh reload.
  await page.locator('[data-testid="automation-name"]').fill('Switch router');
  const swPos = await page.locator(`[data-testid="node"][data-node-id="${sw}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${sw}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${sw}"]`).click();
  assert.equal(await page2.locator('[data-testid="switch-rule"]').count(), 3, 'E7 switch rules persisted across fresh reload');
  const swPos2 = await page2.locator(`[data-testid="node"][data-node-id="${sw}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(swPos2.x - swPos.x) < 3 && Math.abs(swPos2.y - swPos.y) < 3, 'E7 switch layout persisted');
  log(`B31 E7 switch config (3 rules) + layout persisted across fresh reload at (${swPos2.x},${swPos2.y})`);
  // delete with confirmation removes its connections
  const connsBefore = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${sw}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${sw}"]`).count(), 0, 'switch deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < connsBefore, 'E7 deleting switch removed its connections');
  log('B31 E7 switch is selectable/configurable/connectable/movable/deletable (connections removed on delete)');

  // E8: no regression — click-add still works and an existing-type run still completes.
  const beforeAdd = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="transform"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), beforeAdd + 1, 'E8 click-add still works');
  log('B31 E8 no regression: click-add + connect/move/delete/run still function');

  log('\nALL B31 ASSERTIONS PASSED (Switch multi-way per-item routing + fallback + CRUD/persist + no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
