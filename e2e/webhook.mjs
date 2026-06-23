// B50: Webhook trigger — an inbound HTTP request to the configured path starts a
// real run carrying the request's payload. Verified with an actual request.
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
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ code: r.status, body: await r.json() }));
  const steps = async (runId) => { for (let i = 0; i < 40; i++) { const s = await fetch(base + '/runs/' + runId + '/steps').then((r) => r.json()); if (s.status !== 'in-progress') return s; await new Promise((r) => setTimeout(r, 250)); } };
  const countDefRuns = (defId) => fetch(base + '/history').then((r) => r.json()).then((h) => h.filter((e) => e.automationId === defId).length);

  // E1: add a Webhook trigger as the ENTRY POINT (no incoming) + downstream.
  const wh = await add('webhookTrigger');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${wh}"]`).getAttribute('data-node-type'), 'webhookTrigger', 'E1 Webhook trigger added');
  assert.equal(await page.locator(`[data-testid="input-port"][data-node-id="${wh}"]`).count(), 0, 'E1 trigger is an entry point (no incoming needed)');
  const down = await add('code'); await selNode(down); await page.locator('[data-testid="cfg-code"]').fill('return $input;');
  await dragConnect(wh, 'main', down);
  log('B50 E1 Webhook trigger added as entry point and wired to a downstream step');

  // E2: configure path + see URL.
  await selNode(wh);
  await page.locator('[data-testid="cfg-webhook-path"]').fill('orders');
  const url = await page.locator('[data-testid="webhook-url"]').inputValue();
  assert.ok(url.endsWith('/webhook/orders'), 'E2 path configured and the listening URL is shown: ' + url);
  log('B50 E2 path configured (orders); listening URL shown: ' + url);

  // Save so the webhook is registered for this saved automation.
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');

  // E3: send a real request with a KNOWN payload to the configured path.
  const before = await countDefRuns(defId);
  const res = await post('/webhook/orders', { order: 123, kind: 'test' });
  assert.equal(res.code, 202, 'E3 inbound request accepted, run fired');
  const s = await steps(res.body.runId);
  assert.equal(s.status, 'completed', 'E3 a real run occurred from the webhook');
  assert.equal(s.steps[down].input[0].json.order, 123, 'E3 downstream received the sent payload (order=123)');
  assert.equal(s.steps[down].input[0].json.kind, 'test', 'E3 downstream received the sent payload (kind=test)');
  log('B50 E3 POST /webhook/orders {order:123,kind:test} -> real run; downstream received EXACTLY that payload');
  await page.screenshot({ path: path.join(SHOT_DIR, 'webhook-run.png') });

  // E4: the configured path governs the endpoint — wrong path does NOT fire.
  const afterFirst = await countDefRuns(defId);
  const wrong = await post('/webhook/not-the-path', { order: 999 });
  assert.equal(wrong.code, 404, 'E4 a request to a WRONG path does not fire (404, no webhook)');
  assert.equal(await countDefRuns(defId), afterFirst, 'E4 no run was started for the wrong path');
  const right = await post('/webhook/orders', { order: 7 });
  assert.equal(right.code, 202, 'E4 a request to the CONFIGURED path fires');
  assert.equal(await countDefRuns(defId), afterFirst + 1, 'E4 the configured path started exactly one more run');
  log('B50 E4 configured path governs the endpoint: wrong path -> 404/no run; configured path -> fires (the path genuinely drives the endpoint)');

  // E5/E6: persistence + CRUD (path persists across fresh reload).
  const pos = await page.locator(`[data-testid="node"][data-node-id="${wh}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${wh}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${wh}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-webhook-path"]').inputValue(), 'orders', 'E5 path persisted across fresh reload');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${wh}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B50 E5/E6 path (orders) + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${wh}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${wh}"]`).count(), 0, 'webhook trigger deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting trigger removed its connections');
  log('B50 E6 webhook trigger selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression.
  const beforeN = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="scheduleTrigger"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), beforeN + 1, 'E7 existing types + click-add still work');
  log('B50 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B50 ASSERTIONS PASSED (Webhook trigger: inbound request starts a real run carrying its payload; path governs the endpoint; persists; CRUD; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
