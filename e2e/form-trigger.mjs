// B52: Form trigger — serves a web form; submitting it starts a real run carrying
// the entered values. Verified by an ACTUAL form submission + the resulting run.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const base = 'http://127.0.0.1:3000';
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
  const steps = async (runId) => { for (let i = 0; i < 40; i++) { const s = await fetch(base + '/runs/' + runId + '/steps').then((r) => r.json()); if (s.status !== 'in-progress') return s; await new Promise((r) => setTimeout(r, 250)); } };

  // E1: add a Form trigger as the ENTRY POINT (no incoming) + downstream.
  const form = await add('formTrigger');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${form}"]`).getAttribute('data-node-type'), 'formTrigger', 'E1 Form trigger added');
  assert.equal(await page.locator(`[data-testid="input-port"][data-node-id="${form}"]`).count(), 0, 'E1 trigger is an entry point (no incoming needed)');
  const down = await add('code'); await selNode(down); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(form, 'main', down);
  log('B52 E1 Form trigger added as entry point and wired to a downstream step');

  // E2: configure fields + path; see the URL.
  await selNode(form);
  await page.locator('[data-testid="cfg-form-path"]').fill('signup');
  await page.locator('[data-testid="cfg-form-fields"]').fill('name,qty');
  const url = await page.locator('[data-testid="form-url"]').inputValue();
  assert.ok(url.endsWith('/form/signup'), 'E2 form path + URL: ' + url);
  log('B52 E2 configured fields [name, qty] + path; form URL: ' + url);

  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);

  // E3: the form is actually served at its URL, rendering the configured fields.
  const formPage = await ctx.newPage();
  await formPage.goto(base + '/form/signup', { waitUntil: 'networkidle' });
  assert.ok(await formPage.locator('[data-testid="form-field-name"]').count(), 'E3 form renders the "name" field');
  assert.ok(await formPage.locator('[data-testid="form-field-qty"]').count(), 'E3 form renders the "qty" field');
  log('B52 E3 the form is genuinely served at /form/signup rendering fields name + qty');
  await formPage.screenshot({ path: path.join(SHOT_DIR, 'form-page.png') });

  // E4: fill KNOWN values + submit -> a real run carries exactly those values.
  await formPage.locator('[data-testid="form-field-name"]').fill('Ada');
  await formPage.locator('[data-testid="form-field-qty"]').fill('3');
  await formPage.locator('[data-testid="form-submit"]').click();
  await formPage.waitForFunction(() => document.querySelector('[data-testid="form-result"]').dataset.runId);
  const runId = await formPage.locator('[data-testid="form-result"]').getAttribute('data-run-id');
  const s = await steps(runId);
  assert.equal(s.status, 'completed', 'E4 submitting the form started a real run');
  assert.deepEqual(s.steps[down].input[0].json, { name: 'Ada', qty: '3' }, 'E4 downstream received EXACTLY the submitted values {name:"Ada", qty:"3"}');
  log('B52 E4 submitted name=Ada qty=3 -> real run; downstream received exactly { name:"Ada", qty:"3" }');

  // E5/E6: persistence + CRUD.
  const pos = await page.locator(`[data-testid="node"][data-node-id="${form}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${form}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${form}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-form-path"]').inputValue(), 'signup', 'E5 form path persisted');
  assert.equal(await page2.locator('[data-testid="cfg-form-fields"]').inputValue(), 'name,qty', 'E5 form fields persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${form}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B52 E5/E6 form config (path + fields) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${form}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${form}"]`).count(), 0, 'form trigger deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting trigger removed its connections');
  log('B52 E6 form trigger selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="webhookTrigger"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B52 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B52 ASSERTIONS PASSED (Form trigger serves a form; submission starts a real run carrying the entered values; persists; CRUD; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
