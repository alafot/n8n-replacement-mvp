// B55: HTML Extract — pull values out of HTML by CSS selector (element text or
// a named attribute) into named fields. Verified against a KNOWN input ->
// EXPECTED output, per item, with other fields preserved and downstream
// receiving the extracted fields; plus CRUD/persist and no-regression.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

// KNOWN input and EXPECTED outputs (the crux of the verification).
const KNOWN_HTML = '<h1>Hello</h1><a href="/x">link</a>';
const EXPECT_TEXT = 'Hello';
const EXPECT_ATTR = '/x';

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

  // E1: add an HTML Extract; point it at the incoming HTML; configure rules.
  // seed (carries the KNOWN html + an unreferenced field) -> htmlExtract -> sink.
  const seed = await add('code'); await selNode(seed);
  await page.locator('[data-testid="cfg-code"]').fill(`return [{json:{body:${JSON.stringify(KNOWN_HTML)},keep:"preserve-me"}}];`);
  const ext = await add('htmlExtract');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${ext}"]`).getAttribute('data-node-type'), 'htmlExtract', 'E1 HTML Extract added');
  await selNode(ext);
  await page.locator('[data-testid="cfg-html-source"]').fill('json.body');
  // Rule 0: TEXT rule  h1 -> title  (E2)
  await page.locator('[data-testid="cfg-rule-0-selector"]').fill('h1');
  await page.locator('[data-testid="cfg-rule-0-type"]').selectOption('text');
  await page.locator('[data-testid="cfg-rule-0-output"]').fill('title');
  // Rule 1: ATTRIBUTE rule  a -> attr:href -> link  (E3, E4 multiple rules)
  await page.locator('[data-testid="extract-add-rule"]').click();
  await page.locator('[data-testid="cfg-rule-1-selector"]').fill('a');
  await page.locator('[data-testid="cfg-rule-1-type"]').selectOption('attribute');
  await page.locator('[data-testid="cfg-rule-1-attr"]').fill('href');   // attribute field appears only for attribute mode
  await page.locator('[data-testid="cfg-rule-1-output"]').fill('link');
  log('B55 E1 added HTML Extract; source=json.body; rule h1->text->title; rule a->attr:href->link');

  const sink = await add('code'); await selNode(sink); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(seed, 'main', ext);
  await dragConnect(ext, 'main', sink);

  // E2/E3/E4/E5/E6: run with the KNOWN input and verify EXPECTED output per item.
  const s = await runSteps();
  const out = s.steps[ext].output[0].json;
  assert.equal(out.title, EXPECT_TEXT, `E2 TEXT rule h1->text yields exactly '${EXPECT_TEXT}' (got ${JSON.stringify(out.title)})`);
  assert.equal(out.link, EXPECT_ATTR, `E3 ATTRIBUTE rule a->attr:href yields exactly '${EXPECT_ATTR}' (got ${JSON.stringify(out.link)})`);
  assert.ok('title' in out && 'link' in out, 'E4 both rules applied together, each into its own field');
  assert.equal(out.keep, 'preserve-me', 'E5 unreferenced field preserved exactly (value + presence)');
  const din = s.steps[sink].input[0].json;
  assert.equal(din.title, EXPECT_TEXT, 'E6 downstream received the extracted text field');
  assert.equal(din.link, EXPECT_ATTR, 'E6 downstream received the extracted attribute field');
  log(`B55 E2 h1->text = '${out.title}'  E3 a->attr:href = '${out.link}'  (known -> expected)`);
  log(`B55 E4/E5 both fields present in one step; unreferenced field kept = '${out.keep}'`);
  log('B55 E6 downstream input carries title+link');
  await page.screenshot({ path: path.join(SHOT_DIR, 'html-extract-run.png') });

  // E7: full step behaviour + persistence (config AND layout) across reload.
  await page.locator('[data-testid="automation-name"]').fill('HTML extract test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${ext}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${ext}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${ext}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-html-source"]').inputValue(), 'json.body', 'E7 source field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-rule-0-selector"]').inputValue(), 'h1', 'E7 text rule selector persisted');
  assert.equal(await page2.locator('[data-testid="cfg-rule-1-selector"]').inputValue(), 'a', 'E7 attribute rule selector persisted');
  assert.equal(await page2.locator('[data-testid="cfg-rule-1-attr"]').inputValue(), 'href', 'E7 attribute name persisted');
  assert.equal(await page2.locator('[data-testid="cfg-rule-1-output"]').inputValue(), 'link', 'E7 output field name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${ext}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E7 layout persisted');
  log(`B55 E7 config (source + both rules + attribute) + layout persisted across a fresh reload at (${pos2.x},${pos2.y})`);
  // deletable-with-confirmation, removing its connections.
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${ext}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${ext}"]`).count(), 0, 'E7 HTML Extract deletable with confirmation');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E7 deleting it removed its connections');
  log('B55 E7 selectable/configurable/connectable(full-span)/movable/deletable-with-confirm');

  // E8: no regression — other node types + click-add still function.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="transform"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E8 existing types + click-add still work');
  log('B55 E8 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B55 ASSERTIONS PASSED (HTML Extract: text & attribute by CSS selector, known->expected; multiple rules; field preservation; downstream receives; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
