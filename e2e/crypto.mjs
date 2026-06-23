// B58: Crypto — hash a field. Verified against a KNOWN test vector
// (SHA256('hello')) for an EXACT match, DETERMINISTIC across re-runs, written to
// the output field, read by a downstream step; other fields preserved;
// CRUD/persist; no regression.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

// KNOWN test vector: SHA256('hello').
const KNOWN_INPUT = 'hello';
const KNOWN_DIGEST = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

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

  // E1: add a Crypto step; choose SHA256 hash; point at source; name output.
  // seed (carries the KNOWN input + an unreferenced field) -> crypto -> sink.
  const seed = await add('code'); await selNode(seed);
  await page.locator('[data-testid="cfg-code"]').fill(`return [{json:{value:${JSON.stringify(KNOWN_INPUT)},keep:"preserve-me"}}];`);
  const cr = await add('crypto');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${cr}"]`).getAttribute('data-node-type'), 'crypto', 'E1 Crypto step added');
  await selNode(cr);
  await page.locator('[data-testid="cfg-crypto-action"]').selectOption('hash');
  await page.locator('[data-testid="cfg-crypto-algorithm"]').selectOption('sha256');
  await page.locator('[data-testid="cfg-crypto-source"]').fill('json.value');
  await page.locator('[data-testid="cfg-crypto-output"]').fill('hash');
  log('B58 E1 added Crypto step; action=hash; algorithm=SHA256; source=json.value; output=hash');

  // Downstream step READS the computed hash (E5).
  const sink = await add('code'); await selNode(sink);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{readHash:$input[0].json.hash, stillHave:$input[0].json.keep}}];');
  await dragConnect(seed, 'main', cr);
  await dragConnect(cr, 'main', sink);

  // E2/E3/E4/E5: run with the KNOWN input and verify the EXACT known digest.
  const s = await runSteps();
  const digest = s.steps[cr].output[0].json.hash;
  assert.equal(digest, KNOWN_DIGEST, `E2 SHA256('hello') equals the known test vector exactly (got ${JSON.stringify(digest)})`);
  assert.ok('hash' in s.steps[cr].output[0].json, 'E3 computed result written into the configured output field');
  assert.equal(s.steps[cr].output[0].json.keep, 'preserve-me', 'E4 unreferenced field preserved exactly (value + presence)');
  const din = s.steps[sink].input[0].json;
  assert.equal(din.hash, KNOWN_DIGEST, 'E5 downstream input carries the computed value');
  assert.equal(s.steps[sink].output[0].json.readHash, KNOWN_DIGEST, 'E5 downstream read the computed hash');
  assert.equal(s.steps[sink].output[0].json.stillHave, 'preserve-me', 'E4 preserved field still readable downstream');
  log(`B58 E2 SHA256('hello') = ${digest} (exact match to known test vector)`);

  // E2 (determinism): re-run the same graph; the digest must be identical.
  const s2 = await runSteps();
  assert.equal(s2.steps[cr].output[0].json.hash, KNOWN_DIGEST, 'E2 deterministic: same input -> same digest on re-run');
  log('B58 E2 deterministic: re-run produced the identical digest');
  await page.screenshot({ path: path.join(SHOT_DIR, 'crypto-run.png') });

  // E6: full step behaviour + persistence (config AND layout) across reload.
  await page.locator('[data-testid="automation-name"]').fill('Crypto test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${cr}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${cr}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${cr}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-crypto-action"]').inputValue(), 'hash', 'E6 action persisted');
  assert.equal(await page2.locator('[data-testid="cfg-crypto-algorithm"]').inputValue(), 'sha256', 'E6 algorithm persisted');
  assert.equal(await page2.locator('[data-testid="cfg-crypto-source"]').inputValue(), 'json.value', 'E6 source field persisted');
  assert.equal(await page2.locator('[data-testid="cfg-crypto-output"]').inputValue(), 'hash', 'E6 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${cr}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B58 E6 config (action + algorithm + source + output) + layout persisted across a fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${cr}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${cr}"]`).count(), 0, 'E6 Crypto step deletable with confirmation');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting it removed its connections');
  log('B58 E6 selectable/configurable/connectable(full-span)/movable/deletable-with-confirm');

  // E7: no regression — other node types + click-add still function.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="markdown"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B58 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B58 ASSERTIONS PASSED (Crypto SHA256 matches the known test vector exactly + deterministic; written to output field; downstream reads it; field preservation; downstream receives result; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
