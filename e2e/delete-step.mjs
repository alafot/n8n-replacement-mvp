// B29: delete a step with a confirmation prompt; confirming also removes its
// connections; cancelling leaves everything unchanged.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const connectClick = async (f, port, t) => { await page.locator(`[data-testid="port"][data-node-id="${f}"][data-port="${port}"]`).click(); await page.locator(`[data-testid="node"][data-node-id="${t}"]`).click(); };
  const nodeCount = () => page.locator('[data-testid="node"]').count();
  const conns = () => page.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => `${e.dataset.from}-${e.dataset.port}->${e.dataset.to}`).sort());

  // Build: a -> b -> c, so b is a CONNECTED step (incoming + outgoing).
  const a = await add('httpRequest');
  const b = await add('if');
  const c = await add('code');
  const d = await add('code');
  await connectClick(a, 'main', b);
  await connectClick(b, 'true', c);
  await connectClick(b, 'false', d);
  const connsBefore = await conns();
  log(`built a->b, b[true]->c, b[false]->d; connections: ${JSON.stringify(connsBefore)}`);

  // E1: invoke delete on the connected step b -> confirmation appears, nothing removed yet.
  await page.locator(`[data-testid="node-delete"][data-node-id="${b}"]`).click();
  assert.ok(await page.locator('[data-testid="confirm-delete"]').isVisible(), 'confirmation prompt appears');
  assert.equal(await nodeCount(), 4, 'E1 nothing removed yet — all 4 steps still present while prompt shows');
  assert.deepEqual(await conns(), connsBefore, 'E1 connections still present while prompt shows');
  log('B29 E1 delete prompts for confirmation; step b and its connections still present at that moment');
  await page.screenshot({ path: path.join(SHOT_DIR, 'delete-prompt.png') });

  // E3: cancel leaves everything unchanged.
  await page.locator('[data-testid="confirm-delete-no"]').click();
  assert.ok(!(await page.locator('[data-testid="confirm-delete"]').isVisible()), 'prompt closed on cancel');
  assert.equal(await nodeCount(), 4, 'E3 cancel: steps unchanged');
  assert.deepEqual(await conns(), connsBefore, 'E3 cancel: connections unchanged');
  log('B29 E3 cancel left the automation completely unchanged (4 steps, same connections)');

  // E2: invoke again and confirm -> step b and ALL its connections removed.
  await page.locator(`[data-testid="node-delete"][data-node-id="${b}"]`).click();
  await page.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await nodeCount(), 3, 'E2 confirmed: step removed');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${b}"]`).count(), 0, 'deleted step gone');
  const connsAfter = await conns();
  assert.equal(connsAfter.length, 0, 'E2 all connections incident to b removed (no orphaned links)');
  assert.ok(!JSON.stringify(connsAfter).includes(b), 'no link still references the deleted node');
  log(`B29 E2 confirmed delete: step b gone, all its connections removed (now ${connsAfter.length} connections, no orphans)`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'delete-after.png') });

  // E4: the engine graph no longer contains the step or its connections.
  let payload = null;
  await page.route('**/workflows/run-graph', async (route) => { payload = JSON.parse(route.request().postData()); await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runId: 'preview', status: 'in-progress' }) }); });
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForTimeout(200);
  await page.unroute('**/workflows/run-graph');
  assert.ok(!payload.nodes.some((n) => n.id === b), 'E4 engine graph no longer contains the deleted step');
  assert.ok(!payload.connections.some((cn) => cn.from === b || cn.to === b), 'E4 engine graph has no connections to/from the deleted step');
  log('B29 E4 engine graph updated: deleted step and its connections absent from serialization');

  log('\nALL B29 ASSERTIONS PASSED (confirm-before-remove, removes connections, cancel unchanged, graph updated).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
