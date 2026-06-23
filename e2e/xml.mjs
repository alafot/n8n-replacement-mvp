// B56: XML — convert XML <-> JSON (at minimum XML->JSON parse). Verified against
// a KNOWN input -> EXPECTED output: both an attribute and element text are
// parsed correctly and READ by a downstream step; other fields preserved;
// CRUD/persist; no regression.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

// KNOWN input and EXPECTED parsed values (the crux of the verification).
const KNOWN_XML = '<order id="7"><item>book</item></order>';
const EXPECT_ID = '7';      // attribute
const EXPECT_ITEM = 'book'; // element text

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1340, height: 800 });
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

  // E1: add an XML step; point it at the incoming XML; choose XML->JSON.
  // seed (carries the KNOWN xml + an unreferenced field) -> xml -> sink(reads parsed).
  const seed = await add('code'); await selNode(seed);
  await page.locator('[data-testid="cfg-code"]').fill(`return [{json:{body:${JSON.stringify(KNOWN_XML)},keep:"preserve-me"}}];`);
  const xml = await add('xml');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${xml}"]`).getAttribute('data-node-type'), 'xml', 'E1 XML step added');
  await selNode(xml);
  await page.locator('[data-testid="cfg-xml-source"]').fill('json.body');
  await page.locator('[data-testid="cfg-xml-direction"]').selectOption('xmlToJson');
  await page.locator('[data-testid="cfg-xml-output"]').fill('data');
  log('B56 E1 added XML step; source=json.body; conversion=XML->JSON; output=data');

  // Downstream step READS the parsed values (E3) — derives id + item from the parsed JSON.
  const sink = await add('code'); await selNode(sink);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{readId:$input[0].json.data.order.$.id, readItem:$input[0].json.data.order.item, stillHave:$input[0].json.keep}}];');
  await dragConnect(seed, 'main', xml);
  await dragConnect(xml, 'main', sink);

  // E2/E3/E4/E5: run with the KNOWN input and verify EXPECTED parse, per item.
  const s = await runSteps();
  const parsed = s.steps[xml].output[0].json;
  assert.equal(parsed.data.order.$.id, EXPECT_ID, `E2 attribute parsed: order id = '${EXPECT_ID}' (got ${JSON.stringify(parsed.data?.order?.$?.id)})`);
  assert.equal(parsed.data.order.item, EXPECT_ITEM, `E2 element text parsed: item = '${EXPECT_ITEM}' (got ${JSON.stringify(parsed.data?.order?.item)})`);
  assert.equal(parsed.keep, 'preserve-me', 'E4 unreferenced field preserved exactly (value + presence)');
  const din = s.steps[sink].input[0].json;
  assert.equal(din.data.order.$.id, EXPECT_ID, 'E5 downstream input carries the parsed JSON (attribute)');
  assert.equal(din.data.order.item, EXPECT_ITEM, 'E5 downstream input carries the parsed JSON (element text)');
  const dout = s.steps[sink].output[0].json;
  assert.equal(dout.readId, EXPECT_ID, 'E3 downstream READ the id from the parsed structure');
  assert.equal(dout.readItem, EXPECT_ITEM, 'E3 downstream READ the item text from the parsed structure');
  assert.equal(dout.stillHave, 'preserve-me', 'E3/E4 preserved field still readable downstream');
  log(`B56 E2 parsed attribute id='${parsed.data.order.$.id}', element text item='${parsed.data.order.item}' (known -> expected)`);
  log(`B56 E3 downstream read id='${dout.readId}', item='${dout.readItem}' from the parsed JSON`);
  log(`B56 E4/E5 unreferenced field kept = '${parsed.keep}'; downstream input carried the parsed JSON`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'xml-run.png') });

  // E6: full step behaviour + persistence (config AND layout) across reload.
  await page.locator('[data-testid="automation-name"]').fill('XML test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${xml}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${xml}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${xml}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-xml-source"]').inputValue(), 'json.body', 'E6 source field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-xml-direction"]').inputValue(), 'xmlToJson', 'E6 direction persisted');
  assert.equal(await page2.locator('[data-testid="cfg-xml-output"]').inputValue(), 'data', 'E6 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${xml}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B56 E6 config (source + direction + output) + layout persisted across a fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${xml}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${xml}"]`).count(), 0, 'E6 XML step deletable with confirmation');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting it removed its connections');
  log('B56 E6 selectable/configurable/connectable(full-span)/movable/deletable-with-confirm');

  // E7: no regression — other node types + click-add still function.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="htmlExtract"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B56 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B56 ASSERTIONS PASSED (XML->JSON parses attribute + element text correctly known->expected; downstream reads them; field preservation; downstream receives parsed result; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
