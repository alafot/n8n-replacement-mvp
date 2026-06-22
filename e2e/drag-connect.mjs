// B27: connect steps with an ACTUAL drag gesture, forgiving target (drop on the
// node body, not a tiny port), with branch true/false route selection.
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
  const box = (sel) => page.locator(sel).boundingBox();
  // Drag from a source port, RELEASE on the target node's BODY CENTER (forgiving).
  const dragConnect = async (fromId, port, toId) => {
    const src = await box(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`);
    const tgt = await box(`[data-testid="node"][data-node-id="${toId}"]`);
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + tgt.height / 2, { steps: 10 }); // drop on body, not a port
    await page.mouse.up();
  };
  const conns = () => page.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => ({ from: e.dataset.from, to: e.dataset.to, port: e.dataset.port })));

  const http = await add('httpRequest');
  const gate = await add('if');
  const onTrue = await add('code');
  const onFalse = await add('code');
  log(`placed http=${http} gate=${gate} true-target=${onTrue} false-target=${onFalse}`);

  // E1/E2: drag http -> gate, dropping on the gate's BODY (forgiving target).
  await dragConnect(http, 'main', gate);
  let c = await conns();
  assert.ok(c.some((x) => x.from === http && x.to === gate && x.port === 'main'), 'E1 drag created a connection between the two specific steps');
  log('B27 E1/E2 drag-connect (released on target BODY, not a precise port) created http -> gate');

  // E3: drag the branch TRUE and FALSE outcomes to distinct targets.
  await dragConnect(gate, 'true', onTrue);
  await dragConnect(gate, 'false', onFalse);
  c = await conns();
  assert.ok(c.some((x) => x.from === gate && x.to === onTrue && x.port === 'true'), 'true route created via drag');
  assert.ok(c.some((x) => x.from === gate && x.to === onFalse && x.port === 'false'), 'false route created via drag');
  assert.notEqual(onTrue, onFalse);
  log(`B27 E3 branch routes via drag kept distinct: true->${onTrue}, false->${onFalse}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'drag-connect.png') });

  // E4: the produced structure maps to the engine graph with correct routing.
  let payload = null;
  await page.route('**/workflows/run-graph', async (route) => { payload = JSON.parse(route.request().postData()); await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runId: 'preview', status: 'in-progress' }) }); });
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForTimeout(200);
  await page.unroute('**/workflows/run-graph');
  const t = payload.connections.find((x) => x.from === gate && x.port === 'true');
  const f = payload.connections.find((x) => x.from === gate && x.port === 'false');
  assert.equal(t.to, onTrue, 'serialized true route -> intended target');
  assert.equal(f.to, onFalse, 'serialized false route -> intended target');
  log('B27 E4 serializes to engine graph: ' + JSON.stringify(payload.connections.map((x) => `${x.from}-${x.port}->${x.to}`)));

  log('\nALL B27 ASSERTIONS PASSED (drag-connect, forgiving target, branch routes).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
