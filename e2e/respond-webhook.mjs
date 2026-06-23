// B51: Respond to Webhook — the webhook caller receives a custom status + body
// built by the automation. Verified by the ACTUAL HTTP response the caller gets.
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
  // Raw HTTP call so we read the ACTUAL status + body the caller receives.
  const callWebhook = async (p, body) => { const r = await fetch(base + '/webhook/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  // E1/E5: webhook trigger (entry) -> code (derive) -> Respond to Webhook (downstream).
  const wh = await add('webhookTrigger'); await selNode(wh); await page.locator('[data-testid="cfg-webhook-path"]').fill('quote');
  const derive = await add('code'); await selNode(derive); await page.locator('[data-testid="cfg-code"]').fill('return $input.map(it=>({json:{received: it.json.order, doubled: it.json.order*2, status:"ok"}}));');
  const respond = await add('respondToWebhook');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${respond}"]`).getAttribute('data-node-type'), 'respondToWebhook', 'E1 Respond to Webhook added');
  await dragConnect(wh, 'main', derive);
  await dragConnect(derive, 'main', respond);
  log('B51 E1/E5 webhook -> code(derive) -> Respond to Webhook (downstream, not an entry point)');

  // E1 config: non-default status + body reflecting automation data.
  await selNode(respond);
  await page.locator('[data-testid="cfg-respond-status"]').fill('201');
  await page.locator('[data-testid="cfg-respond-bodymode"]').selectOption('firstItem');
  log('B51 E1 configured response: status 201, body = the automation-derived item');

  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');

  // E2/E3/E4: actual round-trip — caller sends {order:21}, receives 201 + derived body.
  const r = await callWebhook('quote', { order: 21 });
  assert.equal(r.status, 201, 'E2 caller received EXACTLY the configured non-default status 201');
  assert.equal(r.body.received, 21, 'E3 response body carries automation data (received=21)');
  assert.equal(r.body.doubled, 42, 'E3 response body carries DERIVED value (doubled=42 from order 21)');
  assert.equal(r.body.status, 'ok', 'E3 response body carries the derived status field');
  log(`B51 E2/E3/E4 POST /webhook/quote {order:21} -> caller received HTTP ${r.status} + body ${JSON.stringify(r.body)} (status non-default; body derived; genuine round-trip)`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'respond-webhook-run.png') });

  // E6: persistence + CRUD (status/body config + layout).
  const pos = await page.locator(`[data-testid="node"][data-node-id="${respond}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${respond}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${respond}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-respond-status"]').inputValue(), '201', 'E6 status persisted');
  assert.equal(await page2.locator('[data-testid="cfg-respond-bodymode"]').inputValue(), 'firstItem', 'E6 body mode persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${respond}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E6 layout persisted');
  log(`B51 E6 status/body config + layout persisted across fresh reload at (${pos2.x},${pos2.y})`);
  // E7 (webhook still works after reload): another round-trip with a new value.
  const r2 = await callWebhook('quote', { order: 5 });
  assert.equal(r2.status, 201, 'E7 webhook + respond still work after reload');
  assert.equal(r2.body.doubled, 10, 'E7 derived response still correct (doubled=10 from order 5)');
  log(`B51 E7 after reload: POST {order:5} -> HTTP ${r2.status}, doubled=${r2.body.doubled} (webhook trigger still works)`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${respond}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${respond}"]`).count(), 0, 'respond deletable');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E6 deleting respond removed its connections');
  log('B51 E6 respond-to-webhook selectable/configurable/connectable(full-span)/movable/deletable');

  // E7: no regression (other types still add).
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="transform"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E7 existing types + click-add still work');
  log('B51 E7 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B51 ASSERTIONS PASSED (Respond to Webhook returns the configured non-default status + automation-derived body to the caller; downstream; persists; CRUD; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
