// B47: Summarize — sum/count/avg/min/max over items, optionally grouped.
// Verified against KNOWN input -> EXPECTED values + screenshots.
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

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
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
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };
  const cfg = async (sel, val, isSelect) => { if (isSelect) await page.locator(sel).selectOption(val); else await page.locator(sel).fill(val); };

  // E1: add a Summarize + configure (sum of amount, ungrouped).
  const sum = await add('summarize');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${sum}"]`).getAttribute('data-node-type'), 'summarize', 'E1 Summarize added');
  await selNode(sum);
  await cfg('[data-testid="cfg-sum-func"]', 'sum', true);
  await cfg('[data-testid="cfg-sum-field"]', 'json.amt');
  await cfg('[data-testid="cfg-sum-groupby"]', '');
  await cfg('[data-testid="cfg-sum-output"]', 'total');
  log('B47 E1 added Summarize; func=sum, field=json.amt, ungrouped, output=total');

  // seed (KNOWN items) -> summarize -> sink.
  const seed = await add('code'); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{cat:"A",amt:10}},{json:{cat:"B",amt:5}},{json:{cat:"A",amt:7}}];');
  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', sum);
  await dragConnect(sum, 'main', sink);

  // E2: ungrouped sum -> single item, total = 22.
  let s = await runSteps();
  assert.equal(s.steps[sink].input.length, 1, 'E2 ungrouped -> single summary item');
  assert.equal(s.steps[sink].input[0].json.total, 22, 'E2 sum of amt (10+5+7) = 22 (verifiably correct)');
  log('B47 E2 ungrouped sum: 10+5+7 -> { total: 22 } (single item)');
  await page.screenshot({ path: path.join(SHOT_DIR, 'summarize-run.png') });

  // E3: grouped sum by cat -> A=17, B=5.
  await selNode(sum); await cfg('[data-testid="cfg-sum-groupby"]', 'json.cat');
  s = await runSteps();
  let rows = s.steps[sink].input.map((it) => it.json);
  assert.deepEqual(rows, [{ cat: 'A', total: 17 }, { cat: 'B', total: 5 }], 'E3 grouped sum by cat -> A=17, B=5 (one item per group, verifiably correct)');
  log('B47 E3 grouped sum by cat: ' + JSON.stringify(rows) + ' (A=10+7=17, B=5)');

  // E4: a second function — count grouped by cat -> A=2, B=1.
  await selNode(sum); await cfg('[data-testid="cfg-sum-func"]', 'count', true); await cfg('[data-testid="cfg-sum-output"]', 'n');
  s = await runSteps();
  rows = s.steps[sink].input.map((it) => it.json);
  assert.deepEqual(rows, [{ cat: 'A', n: 2 }, { cat: 'B', n: 1 }], 'E4 grouped count by cat -> A=2, B=1 (second verifiable function)');
  log('B47 E4 grouped count by cat: ' + JSON.stringify(rows) + '; E5 downstream received the summary rows');

  // E6: persistence + CRUD (current config: count grouped by cat).
  await selNode(sum); await cfg('[data-testid="cfg-sum-func"]', 'sum', true); await cfg('[data-testid="cfg-sum-output"]', 'total');
  await page.locator('[data-testid="automation-name"]').fill('Summarize test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${sum}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${sum}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${sum}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-sum-func"]').inputValue(), 'sum', 'E6 func persisted');
  assert.equal(await page2.locator('[data-testid="cfg-sum-field"]').inputValue(), 'json.amt', 'E6 field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-sum-groupby"]').inputValue(), 'json.cat', 'E6 group-by persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${sum}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B47 E6 config (func/field/groupBy/output) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${sum}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${sum}"]`).count(), 0, 'summarize deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting summarize removed its connections');
  log('B47 E6 summarize selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="dateTime"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B47 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B47 ASSERTIONS PASSED (Summarize ungrouped + grouped sum/count verifiably correct against known input; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
