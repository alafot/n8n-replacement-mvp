// Driven-browser check for B19 — import a genuine n8n export into the builder;
// assert the canvas shows mapped steps, connections (incl branch routes), and
// per-step config matching the source; then confirm it is editable & runnable.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';
import { readFileSync } from 'fs';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const EXPORT = path.resolve('examples/n8n-export.json');
const source = JSON.parse(readFileSync(EXPORT, 'utf8'));
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  // E1/E6: import the genuine export file via the builder's Import control.
  await page.locator('[data-testid="import-file"]').setInputFiles(EXPORT);
  await page.waitForSelector('[data-testid="node"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node"]').length === 4);
  log('B19 E1 imported the genuine n8n export (real n8n format: n8n-nodes-base.* types, connections-by-name, main output ports)');

  const nodes = await page.locator('[data-testid="node"]').evaluateAll((els) =>
    els.map((e) => ({ id: e.dataset.nodeId, type: e.dataset.nodeType, label: e.querySelector('.node-title').textContent })),
  );
  const byType = Object.fromEntries(nodes.map((n) => [n.type, n]));

  // E2: per-node mapping to equivalent supported types.
  assert.equal(byType.httpRequest.label, 'Fetch lead');
  assert.equal(byType.if.label, 'Score > 50?');
  assert.equal(byType.transform.label, 'Mark qualified');
  assert.equal(byType.code.label, 'Reject lead');
  log('B19 E2 per-node mapping:');
  log("       'Fetch lead' (n8n httpRequest)   -> web-service step (httpRequest)");
  log("       'Score > 50?' (n8n if)            -> branch step (if)");
  log("       'Mark qualified' (n8n set)        -> reshape step (transform)");
  log("       'Reject lead' (n8n code)          -> code step (code)");

  // E5: faithful whole — count & structure.
  assert.equal(nodes.length, 4, 'same number of steps (4)');
  const conns = await page.locator('[data-testid="conn-delete"]').evaluateAll((els) =>
    els.map((e) => ({ from: e.dataset.from, to: e.dataset.to, port: e.dataset.port })),
  );
  assert.equal(conns.length, 3, 'same number of connections (3)');
  log(`B19 E5 faithful whole: ${nodes.length} steps, ${conns.length} connections — none dropped/added/merged`);

  // E3: connections preserved incl branch true/false routes to distinct targets.
  const hasConn = (from, to, port) => conns.some((c) => c.from === from && c.to === to && c.port === port);
  assert.ok(hasConn(byType.httpRequest.id, byType.if.id, 'main'), 'Fetch->IF preserved');
  assert.ok(hasConn(byType.if.id, byType.transform.id, 'true'), 'IF true -> Mark qualified');
  assert.ok(hasConn(byType.if.id, byType.code.id, 'false'), 'IF false -> Reject lead');
  log('B19 E3 connections preserved incl branch routes: Fetch->IF; IF[true]->Mark qualified; IF[false]->Reject lead');

  // E4 (crux): per-step settings carried over to MATCH the source.
  const readCfg = async (nodeId, testid, kind = 'value') => {
    await page.locator(`[data-testid="node"][data-node-id="${nodeId}"]`).click();
    const loc = page.locator(`[data-testid="${testid}"]`);
    return kind === 'value' ? loc.inputValue() : loc.textContent();
  };
  const srcHttp = source.nodes.find((n) => n.name === 'Fetch lead').parameters;
  const url = await readCfg(byType.httpRequest.id, 'cfg-url');
  const method = await readCfg(byType.httpRequest.id, 'cfg-method');
  assert.equal(url, srcHttp.url, 'HTTP url matches source');
  assert.equal(method, srcHttp.method, 'HTTP method matches source');
  const ifLeft = await readCfg(byType.if.id, 'cfg-left');
  const ifOp = await readCfg(byType.if.id, 'cfg-op');
  const ifRight = await readCfg(byType.if.id, 'cfg-right');
  assert.equal(ifLeft, 'json.body.score', 'IF condition field maps source $json.body.score');
  assert.equal(ifOp, 'gt', 'IF operator matches source (gt)');
  assert.equal(ifRight, '50', 'IF compare value matches source (50)');
  const setJson = await readCfg(byType.transform.id, 'cfg-set');
  assert.deepEqual(JSON.parse(setJson), { status: 'qualified', tier: 'gold' }, 'Set field changes match source');
  const code = await readCfg(byType.code.id, 'cfg-code');
  assert.equal(code, source.nodes.find((n) => n.name === 'Reject lead').parameters.jsCode, 'Code body matches source');
  log('B19 E4 per-step settings match source:');
  log(`       HTTP url="${url}" method=${method}; IF ${ifLeft} ${ifOp} ${ifRight}; Set=${setJson}; Code matches`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'import-canvas.png') });

  // E6: editable & runnable (per B16). Point the web-service step at a reachable
  // local endpoint and adjust the branch field, then run.
  await page.locator(`[data-testid="node"][data-node-id="${byType.httpRequest.id}"]`).click();
  await page.locator('[data-testid="cfg-url"]').fill('http://127.0.0.1:4555/value/60');
  await page.locator(`[data-testid="node"][data-node-id="${byType.if.id}"]`).click();
  await page.locator('[data-testid="cfg-left"]').fill('json.body.value');
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runState && document.querySelector('[data-testid="run-status"]').dataset.runState !== 'in-progress', null, { timeout: 15000 });
  const runState = await page.locator('[data-testid="run-status"]').getAttribute('data-run-state');
  assert.equal(runState, 'completed', 'the imported (then edited) automation runs to completion');
  const markStatus = await page.locator(`[data-testid="node"][data-node-id="${byType.transform.id}"]`).getAttribute('data-step-status');
  const rejectStatus = await page.locator(`[data-testid="node"][data-node-id="${byType.code.id}"]`).getAttribute('data-step-status');
  log(`B19 E6 imported automation is editable & runnable per B16: run ${runState}; true-branch '${byType.transform.label}'=${markStatus}, false-branch '${byType.code.label}'=${rejectStatus}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'import-run.png') });

  log('\nALL IMPORT ASSERTIONS PASSED (B19).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
