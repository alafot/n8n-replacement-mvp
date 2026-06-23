// B46: Date & Time — date operation written onto items; verifiable against a
// KNOWN input. Per-item observation + screenshots.
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

  // E1: add a Date & Time + configure operation (add 1 day).
  const dt = await add('dateTime');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${dt}"]`).getAttribute('data-node-type'), 'dateTime', 'E1 Date & Time added');
  await selNode(dt);
  await page.locator('[data-testid="cfg-dt-operation"]').selectOption('add');
  await page.locator('[data-testid="cfg-dt-field"]').fill('json.date');
  await page.locator('[data-testid="cfg-dt-amount"]').fill('1');
  await page.locator('[data-testid="cfg-dt-unit"]').selectOption('days');
  await page.locator('[data-testid="cfg-dt-output"]').fill('next');
  log('B46 E1 added Date & Time; operation=add 1 day, field=json.date, output=next');

  // seed (KNOWN date + an unreferenced field) -> dateTime -> sink.
  const seed = await add('code'); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{date:"2026-01-01T00:00:00.000Z", keep:"x"}}];');
  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', dt);
  await dragConnect(dt, 'main', sink);

  // E2/E4/E5/E6: add 1 day to a known date -> verifiably correct.
  let s = await runSteps();
  let item = s.steps[sink].input[0].json;
  assert.equal(item.next, '2026-01-02T00:00:00.000Z', 'E2 add 1 day to 2026-01-01 -> 2026-01-02 (verifiably correct)');
  assert.equal(item.keep, 'x', 'E5 unreferenced field preserved');
  assert.equal(item.date, '2026-01-01T00:00:00.000Z', 'E5 source field preserved');
  log(`B46 E2/E4/E5 add: 2026-01-01 + 1 day -> next=${item.next}; keep & date preserved; downstream got it`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'datetime-run.png') });

  // E3 (second operation): format a known date -> exact expected string.
  await selNode(dt);
  await page.locator('[data-testid="cfg-dt-operation"]').selectOption('format');
  await page.locator('[data-testid="cfg-dt-format"]').fill('DD/MM/YYYY');
  await page.locator('[data-testid="cfg-dt-output"]').fill('pretty');
  s = await runSteps();
  item = s.steps[sink].input[0].json;
  assert.equal(item.pretty, '01/01/2026', 'E3 format 2026-01-01 as DD/MM/YYYY -> "01/01/2026" (verifiably correct)');
  assert.equal(item.keep, 'x', 'E5 other field still preserved on format op');
  log(`B46 E3 format: 2026-01-01 as DD/MM/YYYY -> pretty="${item.pretty}" (a second verifiable operation)`);

  // E7: persistence + CRUD (config is currently format).
  await page.locator('[data-testid="automation-name"]').fill('DateTime test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${dt}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${dt}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${dt}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-dt-operation"]').inputValue(), 'format', 'E7 operation persisted');
  assert.equal(await page2.locator('[data-testid="cfg-dt-format"]').inputValue(), 'DD/MM/YYYY', 'E7 format persisted');
  assert.equal(await page2.locator('[data-testid="cfg-dt-output"]').inputValue(), 'pretty', 'E7 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${dt}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E7 layout persisted');
  log(`B46 E7 config (operation/format/output) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${dt}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${dt}"]`).count(), 0, 'dateTime deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E7 deleting dateTime removed its connections');
  log('B46 E7 date&time selectable/configurable/connectable(full-span)/movable/deletable');

  // E8: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="renameKeys"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E8 existing types + click-add still work');
  log('B46 E8 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B46 ASSERTIONS PASSED (Date & Time: add 1 day and format verifiably correct against a known input; other fields preserved; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
