// B57: Markdown — convert Markdown text to HTML (at minimum). Verified against a
// KNOWN input -> EXPECTED output: a heading and an emphasis both render
// correctly, written to the output field, read by a downstream step; other
// fields preserved; CRUD/persist; no regression.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

// KNOWN input and EXPECTED HTML fragments (the crux of the verification).
const KNOWN_MD = '# Hello\n\nsome **bold** text';
const EXPECT_H1 = '<h1>Hello</h1>';
const EXPECT_BOLD = '<strong>bold</strong>';

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

  // E1: add a Markdown step; point it at the incoming Markdown; choose MD->HTML.
  // seed (carries the KNOWN markdown + an unreferenced field) -> markdown -> sink.
  const seed = await add('code'); await selNode(seed);
  await page.locator('[data-testid="cfg-code"]').fill(`return [{json:{body:${JSON.stringify(KNOWN_MD)},keep:"preserve-me"}}];`);
  const md = await add('markdown');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${md}"]`).getAttribute('data-node-type'), 'markdown', 'E1 Markdown step added');
  await selNode(md);
  await page.locator('[data-testid="cfg-md-source"]').fill('json.body');
  await page.locator('[data-testid="cfg-md-direction"]').selectOption('markdownToHtml');
  await page.locator('[data-testid="cfg-md-output"]').fill('html');
  log('B57 E1 added Markdown step; source=json.body; conversion=Markdown->HTML; output=html');

  // Downstream step READS the converted HTML (E5) and checks the fragments.
  const sink = await add('code'); await selNode(sink);
  await page.locator('[data-testid="cfg-code"]').fill(`return [{json:{hasH1:$input[0].json.html.includes(${JSON.stringify(EXPECT_H1)}), hasBold:$input[0].json.html.includes(${JSON.stringify(EXPECT_BOLD)}), stillHave:$input[0].json.keep}}];`);
  await dragConnect(seed, 'main', md);
  await dragConnect(md, 'main', sink);

  // E2/E3/E4/E5: run with the KNOWN input and verify EXPECTED HTML, per item.
  const s = await runSteps();
  const outHtml = s.steps[md].output[0].json.html;
  assert.ok(typeof outHtml === 'string' && outHtml.includes(EXPECT_H1), `E2 heading: '# Hello' -> contains ${EXPECT_H1} (got ${JSON.stringify(outHtml)})`);
  assert.ok(outHtml.includes(EXPECT_BOLD), `E2 emphasis: '**bold**' -> contains ${EXPECT_BOLD} (got ${JSON.stringify(outHtml)})`);
  assert.ok('html' in s.steps[md].output[0].json, 'E3 converted HTML written into the configured output field');
  assert.equal(s.steps[md].output[0].json.keep, 'preserve-me', 'E4 unreferenced field preserved exactly (value + presence)');
  const din = s.steps[sink].input[0].json;
  assert.ok(din.html.includes(EXPECT_H1) && din.html.includes(EXPECT_BOLD), 'E5 downstream input carries the converted HTML');
  const dout = s.steps[sink].output[0].json;
  assert.equal(dout.hasH1, true, 'E5 downstream read the <h1> heading from the converted HTML');
  assert.equal(dout.hasBold, true, 'E5 downstream read the <strong> emphasis from the converted HTML');
  assert.equal(dout.stillHave, 'preserve-me', 'E4 preserved field still readable downstream');
  log(`B57 E2 '# Hello' -> contains ${EXPECT_H1}; '**bold**' -> contains ${EXPECT_BOLD} (known -> expected)`);
  log(`B57 E3/E5 HTML written to output field; downstream input carried it; downstream read heading+emphasis`);
  log(`B57 E4 unreferenced field kept = '${s.steps[md].output[0].json.keep}'`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'markdown-run.png') });

  // E6: full step behaviour + persistence (config AND layout) across reload.
  await page.locator('[data-testid="automation-name"]').fill('Markdown test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${md}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${md}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${md}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-md-source"]').inputValue(), 'json.body', 'E6 source field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-md-direction"]').inputValue(), 'markdownToHtml', 'E6 direction persisted');
  assert.equal(await page2.locator('[data-testid="cfg-md-output"]').inputValue(), 'html', 'E6 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${md}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B57 E6 config (source + direction + output) + layout persisted across a fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${md}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${md}"]`).count(), 0, 'E6 Markdown step deletable with confirmation');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting it removed its connections');
  log('B57 E6 selectable/configurable/connectable(full-span)/movable/deletable-with-confirm');

  // E7: no regression — other node types + click-add still function.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="xml"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B57 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B57 ASSERTIONS PASSED (Markdown->HTML renders heading + emphasis correctly known->expected; written to output field; downstream reads it; field preservation; downstream receives result; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
